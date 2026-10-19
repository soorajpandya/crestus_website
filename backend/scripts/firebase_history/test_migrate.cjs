const test=require('node:test');
const assert=require('node:assert/strict');
const {processGroup,verify,rollbackGroup,validateSafety}=require('./migrate.cjs');
const clone=x=>structuredClone(x);
const at=(o,k)=>k.split('.').reduce((v,p)=>v?.[p],o);
const DELETED='__DELETE_FIELD__';
function set(o,k,v){const p=k.split('.');let n=o;for(const s of p.slice(0,-1))n=n[s]??=( {} );if(v===DELETED)delete n[p.at(-1)];else n[p.at(-1)]=clone(v);}

// Optimistic transactional model: retries conflicting reads/queries and enforces read-before-write.
class MemoryDB {
  constructor(){this.docs=new Map();this.version=0;this.writes=0;}
  doc(p){return {path:p,collection:n=>this.collection(p+'/'+n)};}
  collection(p){return {path:p,doc:id=>this.doc(p+'/'+id),where:(field,op,value)=>({query:p,field,value})};}
  snap(ref,docs=this.docs){const data=docs.get(ref.path);return {ref,exists:data!==undefined,data:()=>clone(data)};}
  async getAll(...refs){return refs.map(r=>this.snap(r));}
  async runTransaction(fn){
    for(let retry=0;retry<20;retry++) {
      const version=this.version,docs=new Map(this.docs),writes=[];
      const tx={
        get:async ref=>{assert.equal(writes.length,0,'No reads after writes');if(ref.query){return {docs:[...docs].filter(([p,v])=>p.split('/').slice(0,-1).join('/')===ref.query&&at(v,ref.field)===ref.value).map(([p])=>this.snap(this.doc(p),docs))};}return this.snap(ref,docs);},
        create:(ref,data)=>writes.push({type:'create',ref,data:clone(data)}),
        update:(ref,data)=>writes.push({type:'update',ref,data:clone(data)}),
        delete:ref=>writes.push({type:'delete',ref}),
      };
      const result=await fn(tx);
      if(version!==this.version)continue;
      for(const w of writes){if(w.type==='create'){assert(!this.docs.has(w.ref.path));this.docs.set(w.ref.path,w.data);}else if(w.type==='update'){const old=clone(this.docs.get(w.ref.path));for(const [k,v]of Object.entries(w.data))set(old,k,v);this.docs.set(w.ref.path,old);}else this.docs.delete(w.ref.path);}
      if(writes.length)this.version++;this.writes+=writes.length;return result;
    }
    throw Error('Exceeded model retries');
  }
}
function fixture(){
  const normalized={cashfree_order_id:'source_0001',cf_payment_id:'000123',original_status:'SUCCESS',money:{Amount:{minor:29}},currency:'INR',settlement:{original_status:'NOT_SETTLED'}};
  const group={group_id:'group1',source_order_id:'source_0001',order_path:'orders/ord_cf_test',identity_path:'cashfree_order_identities/group1',action:'create',before:null,patch:{},proposed:{order_id:'ord_cf_test',record_kind:'historical_wallet_deposit',payment:{cashfree_order_id:'source_0001',cf_payment_id:'000123',amount_paid_minor:29},fulfillment:{due:false},tracking:{active:false},import_metadata:{merchant_scope:'merchant',side_effects_disabled:true},import_run_id:'run'},rows:[{source_position:1,ledger_path:'cashfree_import_transactions/source_1',identity_path:'cashfree_transaction_identities/000123',source_columns:[{header:'Reference Id',value:'000123'}],row_sha256:'rowhash',normalized}]};
  const plan={run_id:'run',summary:{project:'crestus-6f962',database:'(default)',source_sha256:'source',source_filename:'report.csv',controls:{orders:1,rows:1,statuses:{SUCCESS:1},success_minor:29}},groups:[group]};
  return {plan,group};
}
test('concurrent identical imports commit once; rerun performs zero writes and readback reconciles',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();
  const result=await Promise.all([processGroup(db,plan,group,'review'),processGroup(db,plan,group,'review')]);
  assert.deepEqual(result.map(x=>x.action).sort(),['create','noop']);
  const writes=db.writes;assert.equal((await processGroup(db,plan,group,'review')).action,'noop');assert.equal(db.writes,writes);
  const report=await verify(db,plan);assert.equal(report.ok,true);assert.equal(report.success_minor,29);
  assert.equal(db.docs.get('cashfree_import_transactions/source_1').source_columns[0].value,'000123');
});
test('new exact provider match aborts before any import writes',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();db.docs.set('orders/existing',{payment:{cashfree_order_id:'source_0001'}});
  await assert.rejects(processGroup(db,plan,group,'review'),/CONCURRENT_PROVIDER_MATCH/);assert.equal(db.writes,0);
});
test('cross-order payment identity collision aborts atomically',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();db.docs.set(group.rows[0].identity_path,{order_path:'orders/another',amount_minor:29,currency:'INR'});
  await assert.rejects(processGroup(db,plan,group,'review'),/PAYMENT_IDENTITY_CONFLICT/);assert.equal(db.writes,0);
});
test('existing document merge preserves unrelated fields and backs up originals',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();group.action='update';group.before={payment:{cashfree_order_id:'source_0001'},items:[{name:'Existing'}]};group.patch={'payment.cf_payment_id':'000123'};db.docs.set(group.order_path,clone(group.before));
  await processGroup(db,plan,group,'review');assert.equal(db.docs.get(group.order_path).items[0].name,'Existing');
  assert.deepEqual(db.docs.get('cashfree_import_runs/run/backups/group1').before,group.before);
  await rollbackGroup(db,plan,group,DELETED,'review');assert.deepEqual(db.docs.get(group.order_path),group.before);
});
test('rollback only removes unchanged import documents; audit ledger stays append-only',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();await processGroup(db,plan,group,'review');
  await rollbackGroup(db,plan,group,DELETED,'review');assert(!db.docs.has(group.order_path));assert(db.docs.has(group.rows[0].ledger_path));
  const writes=db.writes;assert.equal((await rollbackGroup(db,plan,group,DELETED,'review')).action,'noop');assert.equal(db.writes,writes);
});
test('rollback rejects modifications after import',async()=>{
  const db=new MemoryDB(),{plan,group}=fixture();await processGroup(db,plan,group,'review');db.docs.get(group.order_path).changed=true;
  await assert.rejects(rollbackGroup(db,plan,group,DELETED,'review'),/ROLLBACK_DOCUMENT_MODIFIED/);
});
test('unverified deployment, invalid time and wrong reviewed plan fail closed',()=>{
  const {plan}=fixture();assert.throws(()=>validateSafety({},plan,'review'),/LIVE_SAFETY_VERIFICATION_REQUIRED/);
  const safe={project:plan.summary.project,database:'(default)',source_sha256:'source',plan_sha256:'review',deployed_import_guards_verified:true,trigger_inventory_verified:true,private_collections_rules_verified:true,evidence:'private audit',verified_at:new Date().toISOString()};
  validateSafety(safe,plan,'review');assert.throws(()=>validateSafety({...safe,verified_at:'invalid'},plan,'review'));
  assert.throws(()=>validateSafety(safe,plan,'changed-review'));
});
module.exports={MemoryDB,fixture,DELETED};
