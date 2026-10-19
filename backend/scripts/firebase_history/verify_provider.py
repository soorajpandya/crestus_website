"""Read-only sample identity/timezone verification; never prints payment data."""
import csv
import hashlib
import json
import os
import argparse
from decimal import Decimal
import urllib.request
from pathlib import Path
from datetime import datetime


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path('/Users/apple/Downloads/Transaction Report 13 Oct 2026 - 15 Oct 2026.csv'))
    parser.add_argument('--env',type=Path,default=Path('.env'))
    parser.add_argument('--out',type=Path,default=Path('.data/firebase-history/provider-evidence.json'))
    args=parser.parse_args()
    from dotenv import dotenv_values
    env = dotenv_values(args.env)
    src = args.source
    with src.open(newline='', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    samples = []
    for status in sorted({r['Transaction Status'] for r in rows}):
        subset = [r for r in rows if r['Transaction Status'] == status]
        samples.extend([min(subset, key=lambda r:r['Transaction Time']), max(subset, key=lambda r:r['Transaction Time'])])
    client = env.get('CASHFREE_CLIENT_ID', '')
    secret = env.get('CASHFREE_CLIENT_SECRET', '')
    if not client or not secret:
        raise RuntimeError('Cashfree credentials unavailable')
    if env.get('CASHFREE_ENV') not in ('production', 'live'):
        raise RuntimeError('Expected production Cashfree environment')
    results = []
    for row in samples:
        url = 'https://api.cashfree.com/pg/orders/' + row['Order Id'] + '/payments'
        req = urllib.request.Request(url, headers={'x-client-id':client,'x-client-secret':secret,'x-api-version':env.get('CASHFREE_API_VERSION','2025-01-01')})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payments = json.load(response)
            order_req=urllib.request.Request(url.removesuffix('/payments'),headers=dict(req.header_items()))
            with urllib.request.urlopen(order_req,timeout=30) as response:
                order=json.load(response)
            match = next((p for p in payments if str(p.get('cf_payment_id')) == row['Reference Id']), None)
            t = match.get('payment_time') if match else None
            time_matches = bool(t and datetime.fromisoformat(t).replace(tzinfo=None) == datetime.fromisoformat(row['Transaction Time']))
            results.append({'source_order_id':row['Order Id'],'reference_id':row['Reference Id'],'matched':bool(match),'status_matches':bool(match and match['payment_status']==row['Transaction Status']),'amount_matches':bool(match and Decimal(str(match['payment_amount'])) == Decimal(row['Amount'])),'order_amount_matches':Decimal(str(order['order_amount']))==Decimal(row['Order Amount']),'api_payment_time':t,'csv_transaction_time':row['Transaction Time'],'time_matches':time_matches,'payment':match,'order':order})
        except Exception as e:
            results.append({'source_order_id':row['Order Id'],'error_type':type(e).__name__,'http_status':getattr(e,'code',None)})
    evidence = {'merchant_scope':'cashfree_live_' + hashlib.sha256(client.encode()).hexdigest()[:24], 'source_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'samples':results}
    out=args.out
    out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('w') as f: json.dump(evidence,f,indent=2)
    os.chmod(out,0o600)
    print(json.dumps({'sample_count':len(results),'matched':sum(r.get('matched',False) for r in results),'status_matches':sum(r.get('status_matches',False) for r in results),'time_matches':sum(r.get('time_matches',False) for r in results),'offsets':sorted({r.get('api_payment_time','')[-6:] for r in results}),'errors':sum('error_type' in r for r in results)}))

if __name__ == '__main__':
    main()
