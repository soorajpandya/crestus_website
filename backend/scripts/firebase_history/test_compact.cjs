const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryDB,fixture}=require('./test_migrate.cjs');
const {processCompactGroup,verifyCompact,writesFor,rollbackCompactGroup}=require('./compact.cjs');
test('compact concurrent import and actual transaction rerun write each source identity exactly once',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();
  const outcomes=await Promise.all([processCompactGroup(db,plan,group,'review'),processCompactGroup(db,plan,group,'review')]);
  assert.deepEqual(outcomes.map(o=>o.action).sort(),['create','noop']);
  assert.equal(db.writes,4);const n=db.writes;await processCompactGroup(db,plan,group,'review');assert.equal(db.writes,n);
  assert.equal((await verifyCompact(db,plan,'review')).ok,true);
  assert(![...db.docs.keys()].some(p=>p.includes('/backups/')||p.includes('/groups/')||p.startsWith('cashfree_order_identities/')));
});
test('compact preserves original order fields and physical attempt/ledger paths',async()=>{
  const {plan,group}=fixture();const expected=writesFor(plan,group,'review','2026-10-15T13:00:00Z');
  for(const [k,v]of Object.entries(group.proposed)){if(['import_metadata','updated_at','imported_at'].includes(k))continue;assert.deepEqual(expected[0].data[k],v);}
  assert(expected.some(w=>w.path===group.rows[0].ledger_path));
  assert(expected.some(w=>w.path===group.rows[0].identity_path));
  assert.equal(expected.filter(w=>w.path.includes('/cashfree_payment_attempts/')).length,1);
});
test('compact rejects unexpected provider matches and claims before committing',async()=>{
  for(const collision of ['order','claim']){
    const db=new MemoryDB(),{plan,group}=fixture();
    if(collision==='order')db.docs.set('orders/other',{payment:{cashfree_order_id:group.source_order_id}});
    else db.docs.set(group.rows[0].identity_path,{order_path:'orders/other'});
    await assert.rejects(processCompactGroup(db,plan,group,'review'));assert.equal(db.writes,0);
  }
});
test('compact readback detects even a single changed source cell',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();await processCompactGroup(db,plan,group,'review');
  db.docs.get(group.rows[0].ledger_path).source_columns[0].value='changed';
  const r=await verifyCompact(db,plan,'review');assert.equal(r.ok,false);assert.equal(r.rows,0);
});
test('compact rollback deletes only unchanged import data and retains immutable source evidence',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();await processCompactGroup(db,plan,group,'review');
  await rollbackCompactGroup(db,plan,group,'review');assert(!db.docs.has(group.order_path));assert(db.docs.has(group.rows[0].ledger_path));
  const n=db.writes;assert.equal((await rollbackCompactGroup(db,plan,group,'review')).action,'noop');assert.equal(db.writes,n);
});
test('compact rollback refuses a later modification',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();await processCompactGroup(db,plan,group,'review');db.docs.get(group.order_path).modified=true;
  const n=db.writes;await assert.rejects(rollbackCompactGroup(db,plan,group,'review'),/ROLLBACK_DOCUMENT_MODIFIED/);assert.equal(db.writes,n);
});
test('source readback accepts only the explicitly approved later address assignment',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();await processCompactGroup(db,plan,group,'review');
  const order=db.docs.get(group.order_path);order.billing_address={line1:'Approved synthetic address'};
  order.billing_address_assignment={run_id:'address_run',source_sha256:'xlsx',before:{billing_address_exists:false,assignment_exists:false}};
  const addresses={source_order_plan_sha256:'review',run_id:'address_run',source_sha256:'xlsx',assignments:[{order_path:group.order_path,billing_address:order.billing_address}]};
  assert.equal((await verifyCompact(db,plan,'review',addresses)).ok,true);
  assert.equal((await verifyCompact(db,plan,'review')).ok,false);
  order.payment.amount_paid_minor++;assert.equal((await verifyCompact(db,plan,'review',addresses)).ok,false);
});
