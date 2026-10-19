"""Prepare the explicitly requested cyclic billing-address assignment. No database writes."""
import argparse
import hashlib
import json
import os
from collections import Counter
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--addresses',type=Path,required=True);p.add_argument('--orders',type=Path,required=True)
    p.add_argument('--outcomes',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();addresses=json.loads(a.addresses.read_text());orders=json.loads(a.orders.read_text());outcomes=json.loads(a.outcomes.read_text())
    workbook=json.loads((a.addresses.parent/'workbook-contents.json').read_text())
    if len(addresses)!=761 or len({r['values']['Address ID'] for r in addresses})!=761:raise ValueError('Unexpected address pool')
    if any(str(i)!=r['values']['Sr No'] for i,r in enumerate(addresses,1)):raise ValueError('Spreadsheet order is not contiguous')
    expected={g['group_id'] for g in orders['groups']}
    if {r['group_id'] for r in outcomes if r['action'] in ['create','noop']}!=expected:raise ValueError('Order import not fully committed')
    groups=sorted(orders['groups'],key=lambda g:(min(r['normalized']['transaction_time'] for r in g['rows']),g['source_order_id'],g['order_path']))
    run='billing_cycle_'+workbook['source_sha256'][:20]+'_'+orders['run_id'][-12:]
    assignments=[]
    for i,g in enumerate(groups):
        row=addresses[i%len(addresses)];v=row['values'];customer=g['proposed']['customer']
        address={'address_id':v['Address ID'],'line1':v['Address Line 1'],'line2':v['Address Line 2'],
                 'landmark':v['Landmark'],'area_locality':v['Area / Locality'],'city':v['City'],'district':v['District'],
                 'state':v['State'],'pincode':str(v['Pincode']),'country':v['Country'],'address_type':v['Address Type'],'full_address':v['Full Address'],
                 'name':customer.get('name'),'email':customer.get('email'),'phone':customer.get('phone')}
        provenance={'run_id':run,'source':'delivery_addresses_xlsx','source_filename':workbook['source_filename'],
                    'source_sha256':workbook['source_sha256'],'sheet':'Addresses','spreadsheet_row':row['row'],
                    'address_id':v['Address ID'],'order_position':i+1,'cycle':i//len(addresses)+1,
                    'assignment_method':'user_requested_sequential_cycle_by_earliest_transaction',
                    'customer_address_relationship_verified':False,'source_order_import_run_id':orders['run_id']}
        assignments.append({'order_path':g['order_path'],'earliest_transaction_time':min(r['normalized']['transaction_time'] for r in g['rows']),
                            'billing_address':address,'billing_address_assignment':provenance})
    plan={'project':'crestus-6f962','database':'(default)','run_id':run,'source_sha256':workbook['source_sha256'],
          'source_order_import_run_id':orders['run_id'],'source_order_plan_sha256':hashlib.sha256(a.orders.read_bytes()).hexdigest(),
          'mapping_authorization':'User explicitly selected Assign sequentially and repeat addresses after identifier matching found no matches.',
          'assignments':assignments}
    summary={'imported_orders':len(assignments),'address_pool_rows':len(addresses),'full_cycles':len(assignments)//len(addresses),
             'rows_used_in_last_cycle':len(assignments)%len(addresses),'proposed_order_updates':len(assignments),
             'other_fields_updated':['billing_address_assignment'],'shipping_or_payment_updates':0,'applied_address_updates':0,
             'customer_address_relationship_verified':False,'original_four_orders_included':False,
             'mapping':'Earliest source transaction first; tie by provider order ID then application document path; spreadsheet row order; repeat from first row.',
             'quota_note':'The original import used 16867 writes; 3504 address updates would bring the combined total to 20371, above the Spark 20000-write daily allowance.'}
    a.out.mkdir(parents=True,exist_ok=True);a.out.chmod(0o700)
    for name,data in [('plan.json',plan),('summary.json',summary)]:
        f=a.out/name;f.write_text(json.dumps(data,ensure_ascii=False,indent=2));f.chmod(0o600)
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main()
