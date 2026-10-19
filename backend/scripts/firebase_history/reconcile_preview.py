"""Independently check the prepared plan against the entire original CSV."""
import argparse
import collections
import csv
import hashlib
import json
from decimal import Decimal
from pathlib import Path
from prepare import write_private, digest


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--plan',type=Path,required=True);p.add_argument('--source',type=Path,required=True);a=p.parse_args()
    plan=json.loads(a.plan.read_text());raw=a.source.read_bytes()
    with a.source.open(encoding='utf-8-sig',newline='') as f:
        reader=csv.reader(f,strict=True);headers=next(reader);rows=list(reader)
    groups=plan['groups'];mapped={};exceptions=[];paths=set();identities=set();success=0;amount=Decimal(0);group_amount=0
    for g in groups:
        if g['order_path'] in paths:exceptions.append({'group_id':g['group_id'],'reason':'duplicate_order_path'})
        paths.add(g['order_path']);group_amount+=g['proposed']['payment']['amount_paid_minor']
        for r in g['rows']:
            index=r['source_position'];expected=[{'header':h,'value':v} for h,v in zip(headers,rows[index-1])]
            if index in mapped or r['source_columns']!=expected or digest(expected)!=r['row_sha256']:exceptions.append({'position':index,'reason':'source_row_mismatch_or_duplicate'})
            if r['identity_path'] in identities:exceptions.append({'position':index,'reason':'duplicate_transaction_identity'})
            identities.add(r['identity_path'])
            mapped[index]={'source_position':index,'ledger_path':r['ledger_path'],'attempt_path':g['order_path']+'/cashfree_payment_attempts/'+r['identity_path'].split('/')[-1],'order_path':g['order_path'],'source_order_id':g['source_order_id'],'source_reference_id':r['normalized']['source_transaction_reference'],'outcome':'proposed_'+g['action'],'row_sha256':r['row_sha256']}
            source=dict(zip(headers,rows[index-1]))
            if source['Transaction Status']=='SUCCESS':success+=1;amount+=Decimal(source['Amount'])
    if hashlib.sha256(raw).hexdigest()!=plan['summary']['source_sha256']:exceptions.append({'reason':'file_checksum_mismatch'})
    if set(mapped)!=set(range(1,len(rows)+1)):exceptions.append({'reason':'source_row_coverage_mismatch'})
    if int(amount*100)!=group_amount:exceptions.append({'reason':'paid_total_mismatch'})
    report={'phase':'preview_only','applied':False,'source_rows':len(rows),'preserved_rows_in_plan':len(mapped),'source_columns':len(headers),'order_groups':len(groups),'order_outcomes':dict(collections.Counter(g['action'] for g in groups)),
            'successful_transactions':success,'success_amount_inr':format(amount,'.2f'),'group_paid_minor':group_amount,'exceptions':exceptions,'ok':not exceptions,'scope':'Supplied CSV only; not the account complete history','plan_sha256':hashlib.sha256(a.plan.read_bytes()).hexdigest(),
            'transaction_test_scope':'Synthetic optimistic transaction model; no Firestore writes or live rerun yet',
            'max_group_transaction_writes':max(5+len(g['rows'])*3 for g in groups)}
    write_private(a.plan.parent/'reconciliation-preview.json',report)
    out=a.plan.parent/'source-mapping.jsonl'
    with out.open('w') as f:
        for index in sorted(mapped):f.write(json.dumps(mapped[index],ensure_ascii=False)+'\n')
    out.chmod(0o600)
    print(json.dumps(report,indent=2))
    if exceptions:raise SystemExit(1)

if __name__=='__main__':main()
