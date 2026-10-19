const test = require('node:test');
const assert = require('node:assert/strict');
const {startTestServer, USER_A, ADMIN} = require('./helpers');
const {createOrderDocument, toAdminView} = require('../lib/orders');

function importedOrder() {
  const doc=createOrderDocument({orderId:'ord_cf_test',customer:{name:'Test',email:USER_A.email,phone:'0000000000'},address:null,items:[],totals:{currency:'INR',total:100,shipping:null},pkg:null,pickupLocation:null,shippingQuote:null,cartKeys:[]});
  doc.record_kind='historical_wallet_deposit';doc.import_metadata={side_effects_disabled:true,ownership_verified:false,recognize_revenue:false};
  doc.source='cashfree_transaction_report_csv';doc.created_at=null;doc.user_id=null;
  doc.payment={...doc.payment,status:'paid',cashfree_order_id:'source_test',amount_paid:100,confirmed_via:'historical_csv_import'};
  doc.fulfillment.status='not_applicable';return doc;
}
test('admin reads imported null-field records; matching email confers no ownership or public access',async()=>{
  const t=await startTestServer();
  try {
    const doc=importedOrder();await t.services.store.putOrder(doc);
    const view=toAdminView(doc);assert.equal(view.customer_fulfillment_status,null);assert.equal(view.package,null);assert.deepEqual(view.items,[]);
    const admin=await t.request('GET','/api/admin/orders/ord_cf_test',{user:ADMIN});assert.equal(admin.status,200);assert.equal(admin.data.payment.amount_paid,100);
    const list=await t.request('GET','/api/orders',{user:USER_A});assert.deepEqual(list.data,[]);
    assert.equal((await t.request('GET','/api/orders/ord_cf_test',{user:USER_A})).status,404);
    assert.equal((await t.request('GET','/api/orders/track/ord_cf_test?email='+USER_A.email)).status,404);
  } finally {await t.close();}
});
test('import blocks payment, retry, refunds, fulfillment and tracking even when a job flag is accidentally set',async()=>{
  const t=await startTestServer();
  try {
    const doc=importedOrder();doc.fulfillment={...doc.fulfillment,status:'queued',due:true};await t.services.store.putOrder(doc);
    t.cashfree.PGFetchOrder=async()=>{assert.fail('Historical record must not call provider');};
    const result=await t.services.payments.confirmPayment(doc.order_id,{source:'webhook'});assert.equal(result.changed,false);assert.equal(result.historical_import,true);
    await t.services.fulfillment.processOrder(doc.order_id);
    for(const route of ['payment/verify','fulfillment/retry','fulfillment/cancel','refund','tracking/refresh']) {
      const r=await t.request('POST',`/api/admin/orders/${doc.order_id}/${route}`,{user:ADMIN,body:{}});assert.equal(r.status,409,route);
    }
    for(const op of [()=>t.services.payments.retryPayment(doc.order_id),()=>t.services.payments.createRefund(doc.order_id,{}),()=>t.services.payments.createPaymentSession(doc),()=>t.services.fulfillment.retryStage(doc.order_id),()=>t.services.tracking.refreshFromProvider(doc)])await assert.rejects(op(),e=>e.status===409);
    assert.deepEqual(t.cashfree.calls,[]);
    await t.services.store.updateOrder(doc.order_id,o=>({...o,payment:{...o.payment,status:'pending'}}));
    await t.services.payments.reconcilePendingPayments();
    assert.equal((await t.services.store.getOrder(doc.order_id)).payment.status,'pending');
  } finally {await t.close();}
});
