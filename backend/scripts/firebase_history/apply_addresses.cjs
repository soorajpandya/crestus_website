#!/usr/bin/env node
// Billing-only cyclic assignment, explicitly requested by the user. Dry-run by default.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {readAll}=require('./compact.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
function protectedHash(doc){const copy=clone(doc);delete copy.billing_address;delete copy.billing_address_assignment;return hash(JSON.stringify(canonical(copy)));}
const fail=code=>{const e=Error(code);e.code=code;throw e;};
function save(file,data){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(tmp,file);}
async function assign(db,plan,row){
  return db.runTransaction(async tx=>{
    const ref=db.doc(row.order_path),snapshot=await tx.get(ref);
    if(!snapshot.exists)fail('ORDER_MISSING');
    const current=snapshot.data();
    if(current.import_run_id!==plan.source_order_import_run_id||current.record_kind!=='historical_wallet_deposit')fail('ORDER_OUTSIDE_APPROVED_IMPORT');
    const previous=current.billing_address_assignment;
    if(previous?.run_id===plan.run_id){
      if(!isDeepStrictEqual(clone(current.billing_address),row.billing_address)||previous.source_sha256!==plan.source_sha256||previous.order_position!==row.billing_address_assignment.order_position)fail('PREVIOUS_ASSIGNMENT_MODIFIED');
      return {action:'noop',order_path:ref.path,before:previous.before,after:{billing_address:clone(current.billing_address),billing_address_assignment:clone(previous)}};
    }
    if(previous||current.billing_address!=null)fail('EXISTING_BILLING_ADDRESS_CONFLICT');
    const before={billing_address_exists:Object.hasOwn(current,'billing_address'),billing_address:current.billing_address??null,assignment_exists:Object.hasOwn(current,'billing_address_assignment'),billing_address_assignment:previous??null,protected_document_sha256:protectedHash(current)};
    const provenance={...row.billing_address_assignment,assigned_at:new Date().toISOString(),before};
    // Keep the actual before image in the same atomic write for resumable rollback recovery.
    const update={billing_address:row.billing_address,billing_address_assignment:provenance};
    tx.update(ref,update);
    return {action:'update',order_path:ref.path,before,after:update};
  });
}
async function rollback(db,plan,row,deleteField){
  return db.runTransaction(async tx=>{
    const ref=db.doc(row.order_path),snapshot=await tx.get(ref);
    if(!snapshot.exists)fail('ORDER_MISSING');
    const current=snapshot.data(),assignment=current.billing_address_assignment;
    if(!assignment)return {action:'noop',order_path:ref.path};
    if(assignment.run_id!==plan.run_id||!isDeepStrictEqual(clone(current.billing_address),row.billing_address))fail('ROLLBACK_ADDRESS_MODIFIED');
    const before=assignment.before;if(!before)fail('ROLLBACK_BACKUP_MISSING');
    tx.update(ref,{billing_address:before.billing_address_exists?before.billing_address:deleteField,billing_address_assignment:before.assignment_exists?before.billing_address_assignment:deleteField});
    return {action:'rollback',order_path:ref.path};
  });
}
async function main(){
  const args={};for(let i=2;i<process.argv.length;i++)args[process.argv[i].slice(2)]=['--apply','--verify','--rollback','--resume-failed'].includes(process.argv[i])?true:process.argv[++i];
  const bytes=fs.readFileSync(args.plan),plan=JSON.parse(bytes),digest=hash(bytes),out=args.out||path.dirname(args.plan);
  if(!args.apply&&!args.verify){console.log(JSON.stringify({mode:'dry-run',plan_sha256:digest,target:plan.project+'/'+plan.database,order_updates:plan.assignments.length,method:plan.mapping_authorization,rollback:!!args.rollback},null,2));return;}
  if(args.apply&&args['reviewed-sha256']!==digest)fail('REVIEWED_PLAN_HASH_REQUIRED');
  if(!args['source-plan'])fail('SOURCE_ORDER_PLAN_REQUIRED_FOR_FINANCIAL_VERIFICATION');
  const sourceBytes=fs.readFileSync(args['source-plan']);
  if(hash(sourceBytes)!==plan.source_order_plan_sha256)fail('SOURCE_ORDER_PLAN_HASH_MISMATCH');
  const expectedSuccessMinor=JSON.parse(sourceBytes).summary.controls.success_minor;
  const credential=JSON.parse(fs.readFileSync(args.credential));
  if(credential.project_id!=='crestus-6f962'||plan.project!==credential.project_id||plan.database!=='(default)')fail('WRONG_FIREBASE_TARGET');
  const backend=path.resolve(args.backend),admin=require(path.join(backend,'node_modules/firebase-admin'));
  const {GoogleAuth}=require(path.join(backend,'node_modules/google-auth-library'));
  const auth=await new GoogleAuth({credentials:credential,scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const metadata=(await auth.request({url:`https://firestore.googleapis.com/v1/projects/${plan.project}/databases/(default)`})).data;
  if(metadata.name!==`projects/${plan.project}/databases/(default)`||metadata.type!=='FIRESTORE_NATIVE')fail('DATABASE_IDENTITY_NOT_VERIFIED');
  const app=admin.initializeApp({projectId:plan.project,credential:admin.credential.cert(credential)},'billing-address-assignment'),db=admin.firestore(app);
  db.settings({preferRest:true});
  try{
    let outcomes=[];
    if(args.apply){
      fs.mkdirSync(out,{recursive:true,mode:0o700});let cursor=0,halt=false;
      if(args['resume-failed']){
        if(args.rollback)fail('RESUME_FAILED_REQUIRES_ADDRESS_APPLY');
        const prior=JSON.parse(fs.readFileSync(path.join(out,'address-apply-summary.json')));
        outcomes=JSON.parse(fs.readFileSync(path.join(out,'address-outcomes.json')));
        if(prior.run_id!==plan.run_id||prior.plan_sha256!==digest||outcomes.length!==plan.assignments.length||outcomes.some((o,i)=>o.order_path!==plan.assignments[i].order_path))fail('RESUME_OUTCOMES_PLAN_MISMATCH');
      }
      const pending=plan.assignments.map((_,i)=>i).filter(i=>!['update','noop'].includes(outcomes[i]?.action));
      let completedRequests=0;
      const worker=async()=>{while(cursor<pending.length&&!halt){const i=pending[cursor++],row=plan.assignments[i];let result;
        try{result=args.rollback?await rollback(db,plan,row,admin.firestore.FieldValue.delete()):await assign(db,plan,row);}
        catch(e){result={action:'exception',order_path:row.order_path,code:e.code||'ADDRESS_UPDATE_FAILED',message:String(e.message||'').slice(0,250)};if([8,7,16].includes(e.code))halt=true;}
        outcomes[i]=result;fs.appendFileSync(path.join(out,'address-events.jsonl'),JSON.stringify(result)+'\n',{mode:0o600});
        completedRequests++;
        if(completedRequests%100===0)console.log(JSON.stringify({processed:completedRequests,exceptions:outcomes.filter(o=>o?.action==='exception').length}));
      }};
      await Promise.all([worker(),worker()]);
      for(let i=0;i<plan.assignments.length;i++)if(!outcomes[i])outcomes[i]={action:'not_attempted_after_quota_or_access_error',order_path:plan.assignments[i].order_path};
      save(path.join(out,'address-outcomes.json'),outcomes);
      save(path.join(out,'address-rollback-manifest.json'),{run_id:plan.run_id,plan_sha256:digest,project:plan.project,database:plan.database,records:outcomes.filter(o=>['update','noop'].includes(o.action))});
      const summary={run_id:plan.run_id,plan_sha256:digest,actions:outcomes.reduce((s,o)=>(s[o.action]=(s[o.action]||0)+1,s),{}),requests_this_execution:completedRequests,resumed_failed_only:!!args['resume-failed'],completed_at:new Date().toISOString()};
      save(path.join(out,'address-apply-summary.json'),summary);console.log(JSON.stringify(summary));
      if(outcomes.some(o=>!['update','noop','rollback'].includes(o.action))){process.exitCode=1;return;}
    }
    if(args.rollback)return;
    const snapshots=await readAll(db,plan.assignments.map(a=>a.order_path));
    const report={run_id:plan.run_id,plan_sha256:digest,verified_orders:0,exceptions:[],payment_success_minor:0,assignment_method:'cyclic_pool_not_verified_customer_ownership'};
    for(const row of plan.assignments){
      const snapshot=snapshots.get(row.order_path),data=snapshot?.exists?snapshot.data():null;
      if(!data||!isDeepStrictEqual(clone(data.billing_address),row.billing_address)||data.billing_address_assignment?.run_id!==plan.run_id||data.billing_address_assignment?.order_position!==row.billing_address_assignment.order_position||data.billing_address_assignment?.customer_address_relationship_verified!==false){report.exceptions.push({order_path:row.order_path,reason:'address_or_provenance_mismatch'});continue;}
      report.verified_orders++;
      if(protectedHash(data)!==data.billing_address_assignment.before?.protected_document_sha256)report.exceptions.push({order_path:row.order_path,reason:'non_address_fields_changed'});
      if(data.payment?.status==='paid')report.payment_success_minor+=data.payment.amount_paid_minor;
      if(data.fulfillment?.due||data.tracking?.active||data.payment?.status==='pending')report.exceptions.push({order_path:row.order_path,reason:'unexpected_automatic_job_state'});
    }
    report.expected_payment_success_minor=expectedSuccessMinor;
    if(report.payment_success_minor!==expectedSuccessMinor)report.exceptions.push({reason:'paid_total_mismatch'});
    report.ok=report.exceptions.length===0&&report.verified_orders===plan.assignments.length;report.verified_at=new Date().toISOString();
    save(path.join(out,'address-readback-verification.json'),report);console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
  }finally{await app.delete();}
}
module.exports={assign,rollback,protectedHash};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({error:e.code||'ADDRESS_MIGRATION_FAILED',message:String(e.message||'').slice(0,250)}));process.exitCode=1;});
