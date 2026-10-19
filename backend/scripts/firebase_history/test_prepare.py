import csv
import tempfile
import unittest
from pathlib import Path
from prepare import minor, money, parse, order_document, field_merge, digest


class PreparationTests(unittest.TestCase):
    def test_money_never_coerces_unknown_and_preserves_exact_paise(self):
        self.assertIsNone(minor(''))
        self.assertIsNone(money('N/A'))
        self.assertEqual(minor('0.29'),29)
        self.assertEqual(minor('303141.00'),30314100)
        self.assertEqual(minor('-0.01'),-1)
        for value in ['NaN','Infinity','0.001','garbage']:
            with self.assertRaises(ValueError):minor(value)

    def test_csv_preserves_110_columns_newlines_blank_na_and_leading_zeros(self):
        headers=['Order Id','Reference Id','Transaction Status','Amount']+[f'column_{i}' for i in range(106)]
        cells=['00012','000034','SUCCESS','0.29','comma, and "quote"\nnext line','','N/A']+['']*103
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'report.csv'
            with p.open('w',newline='') as f:
                w=csv.writer(f);w.writerow(headers);w.writerow(cells)
            raw,h,records,rows,controls=parse(p)
        self.assertEqual(h,headers);self.assertEqual(records[0]['cells'],cells)
        self.assertEqual(records[0]['physical_lines'],[2,3])
        self.assertEqual(controls['success_minor'],29)

    def group(self,statuses):
        out=[]
        for i,(status,amount) in enumerate(statuses):
            out.append({'ledger_path':f'ledger/{i}','normalized':{
                'original_status':status,'application_status':{'SUCCESS':'paid','FAILED':'failed'}[status],
                'transaction_time':f'2026-10-14T01:00:0{i}Z','money':{'Amount':{'minor':amount},'Order Amount':{'minor':10000}},
                'currency':'INR','description':'Wallet deposit example','customer':{'name':'Test','email':'example@example.invalid','phone':'0000000000'},
                'cashfree_order_id':'source-order','cf_payment_id':f'000{i}','payment_mode':'UPI','settlement':{'original_status':'NOT_SETTLED'}}})
        return out

    def test_later_failure_does_not_erase_success_or_imply_settlement(self):
        doc=order_document(self.group([('SUCCESS',10000),('FAILED',10000)]),'ord_cf_test','run','sha','merchant')
        self.assertEqual(doc['payment']['status'],'paid')
        self.assertEqual(doc['payment']['amount_paid_minor'],10000)
        self.assertEqual(doc['payment']['settlement_status_counts'],{'NOT_SETTLED':2})
        self.assertIsNone(doc['created_at']);self.assertIsNone(doc['user_id'])
        self.assertEqual(doc['items'],[]);self.assertFalse(doc['fulfillment']['due'])

    def test_partial_multiple_and_overpayments_are_explicit(self):
        partial=order_document(self.group([('SUCCESS',4000)]),'ord','run','sha','merchant')
        self.assertEqual(partial['payment']['status'],'partially_paid')
        multiple=order_document(self.group([('SUCCESS',6000),('SUCCESS',6000)]),'ord','run','sha','merchant')
        self.assertTrue(multiple['payment']['multiple_successes'])
        self.assertEqual(multiple['payment']['overpaid_minor'],2000)
        self.assertIsNone(multiple['payment']['cf_payment_id'])

    def test_merge_reports_invalid_legacy_amount_without_overwriting_business_data(self):
        before={'items':[{'name':'Original item'}],'payment':{'amount_paid':'paid','cashfree_order_id':'source-order'},'source':'website'}
        proposed=order_document(self.group([('SUCCESS',10000)]),'ord','run','sha','merchant')
        patch,conflicts=field_merge(before,proposed)
        self.assertNotIn('payment.amount_paid',patch)
        self.assertTrue(any(c['field']=='payment.amount_paid' for c in conflicts))
        self.assertNotIn('items',patch)
        self.assertEqual(before['payment']['amount_paid'],'paid')

if __name__=='__main__':unittest.main()
