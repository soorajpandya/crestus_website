const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryDB,DELETED}=require('./test_migrate.cjs');
const {assign,rollback,protectedHash}=require('./apply_addresses.cjs');
function fixture(){const db=new MemoryDB(),plan={run_id:'address_run',source_order_import_run_id:'source_run',source_sha256:'xlsxhash'},row={order_path:'orders/ord_cf_example',billing_address:{address_id:'ADDR-0001',line1:'Synthetic address',city:'Test city',pincode:'000001'},billing_address_assignment:{run_id:'address_run',source_sha256:'xlsxhash',order_position:1,customer_address_relationship_verified:false}};db.docs.set(row.order_path,{record_kind:'historical_wallet_deposit',import_run_id:'source_run',billing_address:null,payment:{status:'paid',amount_paid_minor:10000},shipping_address:null,fulfillment:{due:false}});return {db,plan,row};}
test('address assignment updates only billing and provenance and is idempotent under concurrency',async()=>{
  const {db,plan,row}=fixture(),original=structuredClone(db.docs.get(row.order_path));
  const results=await Promise.all([assign(db,plan,row),assign(db,plan,row)]);assert.deepEqual(results.map(x=>x.action).sort(),['noop','update']);assert.equal(db.writes,1);
  const actual=db.docs.get(row.order_path);assert.deepEqual(actual.payment,original.payment);assert.deepEqual(actual.fulfillment,original.fulfillment);assert.equal(actual.shipping_address,null);assert.equal(actual.billing_address_assignment.customer_address_relationship_verified,false);
  assert.equal(actual.billing_address_assignment.before.billing_address,null);
  assert.equal(protectedHash(actual),actual.billing_address_assignment.before.protected_document_sha256);
});
test('existing billing addresses and orders outside the approved imported scope are protected',async()=>{
  for(const kind of ['billing','scope']){const {db,plan,row}=fixture();if(kind==='billing')db.docs.get(row.order_path).billing_address={line1:'Existing'};else db.docs.get(row.order_path).import_run_id='different';await assert.rejects(assign(db,plan,row));assert.equal(db.writes,0);}
});
test('address rollback restores the exact before fields and preserves payment data',async()=>{
  const {db,plan,row}=fixture(),before=structuredClone(db.docs.get(row.order_path));await assign(db,plan,row);await rollback(db,plan,row,DELETED);assert.deepEqual(db.docs.get(row.order_path),before);
});
test('address rollback refuses later address modifications',async()=>{
  const {db,plan,row}=fixture();await assign(db,plan,row);db.docs.get(row.order_path).billing_address.line1='Changed later';await assert.rejects(rollback(db,plan,row,DELETED),/ROLLBACK_ADDRESS_MODIFIED/);
});
test('protected fields hash detects payment changes and ignores map key ordering',async()=>{
  const {db,plan,row}=fixture();await assign(db,plan,row);const doc=db.docs.get(row.order_path),expected=doc.billing_address_assignment.before.protected_document_sha256;
  assert.equal(protectedHash(Object.fromEntries(Object.entries(doc).reverse())),expected);
  doc.payment.amount_paid_minor++;assert.notEqual(protectedHash(doc),expected);
});
