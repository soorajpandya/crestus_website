"""Build a deterministic, private Cashfree -> Firestore plan. No network or writes to Firebase."""
import argparse
import collections
import csv
import hashlib
import json
import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

EXPECTED = {'columns':110, 'rows':4454, 'orders':3504, 'statuses':{'SUCCESS':2344,'USER_DROPPED':1947,'FAILED':103,'INCOMPLETE':60}, 'success_minor':30314100, 'duplicate_references':0}
STATUS = {'SUCCESS':'paid','FAILED':'failed','USER_DROPPED':'abandoned','INCOMPLETE':'incomplete'}
MONEY = ['Amount','Order Amount','Service Charge','ST/GST','One Click Checkout Charges','One Click Checkout Taxes','Settlement Amount','EasySplit Charge','EasySplit Tax','Redemption Amount'] + [f'Vendor Amount {i}' for i in range(1,6)]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def minor(value):
    if value in ('','N/A'):
        return None
    try:
        n = Decimal(value)
    except InvalidOperation as e:
        raise ValueError('Invalid monetary value') from e
    if not n.is_finite() or n * 100 != (n * 100).to_integral_value():
        raise ValueError('Non-finite or sub-paise monetary value')
    v = int(n * 100)
    if abs(v) > 2**53-1:
        raise ValueError('Money exceeds safe Firestore/JavaScript integer range')
    return v


def money(value):
    v = minor(value)
    return None if v is None else {'minor':v, 'decimal':format(Decimal(v)/100, '.2f')}


def normalized(row, evidence):
    original_time = datetime.strptime(row['Transaction Time'], '%Y-%m-%d %H:%M:%S')
    iso = original_time.replace(tzinfo=ZoneInfo('Asia/Kolkata')).astimezone(timezone.utc).isoformat().replace('+00:00','Z')
    return {
        'cashfree_order_id':row['Order Id'], 'source_transaction_reference':row['Reference Id'],
        'cf_payment_id':row['Reference Id'], 'cf_order_id':None,
        'original_status':row['Transaction Status'], 'application_status':STATUS[row['Transaction Status']],
        'currency':row['Currency'], 'money':{k:money(row[k]) for k in MONEY},
        'transaction_time_original':row['Transaction Time'], 'transaction_time':iso,
        'timezone':'Asia/Kolkata', 'timezone_basis':'8 exact provider payment_time matches with +05:30 offset; applied to this report',
        'description':row['Order Note'], 'customer':{'name':row['Customer Name'],'phone':row['Customer Phone'],'email':row['Customer Email']},
        'payment_mode':row['Payment Mode'], 'payment_mode_subtype':row['Payment Mode SubType'],
        'bank_reference':row['Bank Reference No.'] or None,
        'settlement':{'original_status':row['Settlement'],'utr':row['UTR No.'] or None,'settled_on_original':row['Settled On'],'eligibility_time_original':row['Settlement Eligibilty Time']},
        'refunded_original':row['Refunded'], 'link_id':None if not row['Link ID'] else row['Link ID'],
        'provider_identity_evidence_sha256':digest(evidence),
    }


def parse(source):
    raw = source.read_bytes()
    records = []
    with source.open(encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f, strict=True)
        headers = next(reader)
        previous_line = reader.line_num
        for index, cells in enumerate(reader, 1):
            if len(cells) != len(headers):
                raise ValueError(f'Wrong column count at record {index}')
            records.append({'position':index,'csv_record_number':index+1,'physical_lines':[previous_line+1,reader.line_num], 'cells':cells})
            previous_line=reader.line_num
    if len(set(headers)) != len(headers):
        # Raw ordered entries could preserve duplicate headers, but named normalization would be ambiguous.
        raise ValueError('Duplicate headers require explicit normalization mapping')
    rows = [dict(zip(headers,r['cells'])) for r in records]
    controls = {'columns':len(headers),'rows':len(rows),'orders':len({r['Order Id'] for r in rows}),
                'statuses':dict(collections.Counter(r['Transaction Status'] for r in rows)),
                'success_minor':sum(minor(r['Amount']) for r in rows if r['Transaction Status']=='SUCCESS'),
                'duplicate_references':sum(n-1 for n in collections.Counter(r['Reference Id'] for r in rows).values())}
    if any(not r['Order Id'] or not r['Reference Id'] for r in rows):
        raise ValueError('Missing source identifier')
    return raw, headers, records, rows, controls


def order_document(group, order_id, run_id, source_hash, scope):
    values = [r['normalized'] for r in group]
    success = [r for r in values if r['original_status']=='SUCCESS']
    latest = max(values,key=lambda r:r['transaction_time'])
    paid_minor = sum(r['money']['Amount']['minor'] for r in success)
    amounts = {r['money']['Order Amount']['minor'] for r in values}
    currencies = {r['currency'] for r in values}
    if len(amounts)!=1 or len(currencies)!=1:
        raise ValueError('Inconsistent group order amount or currency')
    amount = next(iter(amounts))
    status = ('partially_paid' if paid_minor < amount else 'paid') if success else latest['application_status']
    primary = success[0] if len(success)==1 else None
    refs = [r['ledger_path'] for r in group]
    metadata = {'source':'cashfree_transaction_report_csv','import_run_id':run_id,'source_sha256':source_hash,
                'source_row_refs':refs,'merchant_scope':scope,'source_order_id':latest['cashfree_order_id'],
                'side_effects_disabled':True,'ownership_verified':False,'recognize_revenue':False,
                'created_at_known':False,'known_missing_fields':['created_at','user_id','items','billing_address','shipping_address','package','shipping_quote','tax','discount','cf_order_id','payment_completion_time']}
    return {
        'order_id':order_id,'record_kind':'historical_wallet_deposit','description':latest['description'],
        'source':metadata['source'],'import_run_id':run_id,'source_row_refs':refs,'import_metadata':metadata,
        'created_at':None,'updated_at':None,'imported_at':None,'user_id':None,
        'customer':latest['customer'],'billing_address':None,'shipping_address':None,'billing_same_as_shipping':None,
        'items':[],'package':None,'shipping_quote':None,'pickup_location':None,'cart_keys':[],
        'totals':{'currency':latest['currency'],'total':amount/100,'total_minor':amount,'subtotal':None,'shipping':None,'discount':None,'tax_included':None,'tax_rate_percent':None},
        'payment':{'status':status,'gateway':'cashfree','currency':latest['currency'],'cashfree_order_id':latest['cashfree_order_id'],
                   'cf_order_id':None,'cf_payment_id':primary['cf_payment_id'] if primary else None,'cf_payment_ids':[s['cf_payment_id'] for s in success],
                   'amount_paid':paid_minor/100,'amount_paid_minor':paid_minor,'amount_due':amount/100,'amount_due_minor':amount,
                   'paid_at':None,'observed_success_transaction_time':min((s['transaction_time'] for s in success),default=None),
                   'payment_method':primary['payment_mode'] if primary else None,'payment_session_id':None,'attempts':[],
                   'attempt_collection':f'orders/{order_id}/cashfree_payment_attempts','confirmed_via':'historical_csv_import',
                   'last_failure_reason':None,'refunds':[], 'refunds_known_complete':False,
                   'source_status_counts':dict(collections.Counter(v['original_status'] for v in values)),
                   'multiple_successes':len(success)>1,'overpaid_minor':max(0,paid_minor-amount),
                   'settlement_status_counts':dict(collections.Counter(v['settlement']['original_status'] for v in values))},
        'fulfillment':{'status':'not_applicable','stage':None,'due':False,'next_run_at':None,'attempts':0,'history':[],'last_error':None,'completed_at':None},
        'shipment':{k:None for k in ['sr_order_id','sr_shipment_id','courier_company_id','courier_name','awb_code','pickup','manifest_url','label_url','invoice_url','selected_courier_rate','shipping_cost_variance']},
        'tracking':{'active':False,'status':None,'raw_status':None,'raw_status_id':None,'etd':None,'last_event_at':None,'events':[],'track_url':None,'delivered_at':None},
        'alerts':[],
    }


def field_merge(existing, proposed):
    """Add missing verified leaves only. Never repair non-empty legacy values silently."""
    patch, conflicts = {}, []
    def walk(old, new, prefix=''):
        for key, value in new.items():
            p=f'{prefix}.{key}' if prefix else key
            before=old.get(key)
            if isinstance(value,dict) and isinstance(before,dict):
                walk(before,value,p)
            elif before in (None,'',[]) and value not in (None,'',[]):
                patch[p]=value
            elif before!=value and value not in (None,'',[]):
                conflicts.append({'field':p,'before':before,'proposed':value})
    # Existing business details and source remain intact. Audit provenance is per import,
    # and must never disable legitimate fulfillment on an existing ecommerce order.
    walk(existing, {'payment':proposed['payment'], 'cashfree_imports':{proposed['import_run_id']:proposed['import_metadata']}})
    return patch,conflicts


def write_private(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    os.chmod(path.parent,0o700)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:
        json.dump(value,f,ensure_ascii=False,indent=2)


def prepare(source, existing_file, evidence_file, out):
    raw,headers,records,rows,controls=parse(source)
    if controls != EXPECTED:
        write_private(out/'validation-failed.json', {'expected':EXPECTED,'actual':controls})
        raise ValueError('Source control discrepancy; inspect validation-failed.json')
    if not all(r['Order Note'].startswith('Wallet deposit') and not r['Link ID'] and not r['CF Link ID'] for r in rows):
        raise ValueError('Unexpected description or payment-link ID')
    evidence=json.loads(evidence_file.read_text())
    source_hash=hashlib.sha256(raw).hexdigest()
    if evidence['source_sha256']!=source_hash or len(evidence['samples'])<8 or not all(s.get('matched') and s.get('time_matches') and s.get('amount_matches') and s.get('order_amount_matches') and s.get('api_payment_time','').endswith('+05:30') for s in evidence['samples']):
        raise ValueError('Provider identity/timezone evidence incomplete')
    scope=evidence['merchant_scope']
    run_id='cf_csv_'+source_hash[:24]
    existing=json.loads(existing_file.read_text())
    groups=collections.defaultdict(list)
    for record,row in zip(records,rows):
        entries=[{'header':h,'value':v} for h,v in zip(headers,record['cells'])]
        normalized_row=normalized(row,evidence)
        identity=digest([scope,row['Reference Id']])
        ledger_id=f'{source_hash}_{record["position"]:06d}'
        groups[row['Order Id']].append({'source_position':record['position'],'csv_record_number':record['csv_record_number'],'physical_lines':record['physical_lines'],
            'source_columns':entries,'row_sha256':digest(entries),'source_filename':source.name,'source_sha256':source_hash,'import_run_id':run_id,
            'ledger_path':'cashfree_import_transactions/'+ledger_id,'identity_path':'cashfree_transaction_identities/'+identity,'normalized':normalized_row})
    plans=[]
    for source_id,group in sorted(groups.items()):
        group_id=digest([scope,source_id])
        payment_ids={r['normalized']['cf_payment_id'] for r in group}
        matches=[]
        for old in existing:
            p=old['data'].get('payment',{})
            refs={p.get('cashfree_order_id')}|{a.get('cashfree_order_id') for a in p.get('attempts',[]) if isinstance(a,dict)}
            if source_id in refs or str(p.get('cf_payment_id')) in payment_ids:
                matches.append(old)
        order_id=matches[0]['path'].split('/')[-1] if len(matches)==1 else 'ord_cf_'+group_id[:24]
        proposed=order_document(group,order_id,run_id,source_hash,scope)
        action='create';patch={};conflicts=[];before=None
        if len(matches)>1:
            action='exception';conflicts=[{'reason':'Multiple exact provider matches','paths':[m['path'] for m in matches]}]
        elif matches:
            before=matches[0]['data'];patch,conflicts=field_merge(before,proposed)
            action='conflict' if conflicts else 'update'
        # Do not infer customer consistency/ownership. Preserve each original customer per attempt.
        customer_variants=len({canonical(r['normalized']['customer']) for r in group})
        if customer_variants>1:
            action='conflict';conflicts.append({'reason':'Customer metadata varies within source order','variants':customer_variants})
        plans.append({'group_id':group_id,'source_order_id':source_id,'order_path':'orders/'+order_id,'identity_path':'cashfree_order_identities/'+group_id,
                      'action':action,'before':before,'before_sha256':digest(before),'patch':patch,'conflicts':conflicts,'proposed':proposed,'rows':group})
    summary={'source_sha256':source_hash,'source_bytes':len(raw),'source_filename':source.name,'project':'crestus-6f962','database':'(default)',
             'controls':controls,'expected_controls':EXPECTED,'actions':dict(collections.Counter(g['action'] for g in plans)),
             'existing_order_count':len(existing),'source_scope':'Supplied report only; not complete account history',
             'all_descriptions_wallet_deposit':True,'all_link_ids_blank':True,
             'multiple_success_groups':sum(g['proposed']['payment']['multiple_successes'] for g in plans),
             'partial_payment_groups':sum(g['proposed']['payment']['status']=='partially_paid' for g in plans),
             'success_unsettled_rows':sum(r['Transaction Status']=='SUCCESS' and r['Settlement']=='NOT_SETTLED' for r in rows),
             'application_statuses':dict(collections.Counter(g['proposed']['payment']['status'] for g in plans)),
             'provider_status_changes_since_report':sum(not s['status_matches'] for s in evidence['samples']),
             'timezone':'Asia/Kolkata verified against 8 provider samples',
             'side_effect_review':'Local application guards required; deployed trigger inventory not fully accessible',
             'applied':False}
    summary['planned_document_creates']={
        'orders':sum(g['action']=='create' for g in plans),'cashfree_import_transactions':len(rows),
        'cashfree_payment_attempts':len(rows),'cashfree_transaction_identities':len(rows),
        'cashfree_order_identities':len(plans),'group_checkpoints':len(plans),'backups_and_rollback_entries':len(plans),'run_manifest':1}
    plan={'schema_version':1,'run_id':run_id,'summary':summary,'provider_evidence_sha256':digest(evidence),'status_mapping':STATUS,'groups':plans}
    out.mkdir(parents=True,exist_ok=True);os.chmod(out,0o700)
    archive=out/'source.csv'
    if archive.exists() and archive.read_bytes()!=raw: raise ValueError('Archive already exists with different bytes')
    if not archive.exists():
        fd=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as f:f.write(raw)
    write_private(out/'plan.json',plan)
    write_private(out/'summary.json',summary)
    write_private(out/'exceptions.json',[{'group_id':g['group_id'],'source_order_id':g['source_order_id'],'action':g['action'],'conflicts':g['conflicts']} for g in plans if g['conflicts']])
    samples=[]
    for status in ['paid','abandoned','failed','incomplete']:
        found=next((g for g in plans if g['proposed']['payment']['status']==status),None)
        if found: samples.append({'action':found['action'],'order_path':found['order_path'],'document':found['proposed'],'ledger_example':found['rows'][0]})
    write_private(out/'representative-documents.json',samples)
    print(json.dumps(summary,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--existing',type=Path,required=True)
    p.add_argument('--evidence',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();prepare(a.source,a.existing,a.evidence,a.out)
