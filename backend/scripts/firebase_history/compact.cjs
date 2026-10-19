#!/usr/bin/env node
// Create-only execution of the same reviewed plan with checkpoints embedded in orders.
// Saves auxiliary Firestore writes on Spark. Original ledgers/attempts/identity claims stay separate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {documentFor}=require('./migrate.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const plain=x=>JSON.parse(JSON.stringify(x));
const fail=code=>{const e=Error(code);e.code=code;throw e;};
const privateWrite=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temporary,file);};
function writesFor(plan,g,review,time){
  const doc=documentFor(g,time);
  doc.import_metadata.checkpoint={group_id:g.group_id,review_hash:review,source_sha256:plan.summary.source_sha256,rows:g.rows.length,completed_at:time};
  const writes=[{path:g.order_path,data:doc,rollback:true}];
  for(const row of g.rows){
    const attemptPath=`${g.order_path}/cashfree_payment_attempts/${row.identity_path.split('/').pop()}`;
    writes.push({path:row.identity_path,rollback:true,data:{order_path:g.order_path,attempt_path:attemptPath,cf_payment_id:row.normalized.cf_payment_id,amount_minor:row.normalized.money.Amount.minor,currency:row.normalized.currency,import_run_id:plan.run_id,imported_at:time}});
    writes.push({path:attemptPath,rollback:true,data:{normalized:row.normalized,source:'cashfree_transaction_report_csv',source_row_refs:[row.ledger_path],import_run_id:plan.run_id,imported_at:time}});
    writes.push({path:row.ledger_path,rollback:false,data:{...row,source:'cashfree_transaction_report_csv',imported_at:time,order_path:g.order_path,attempt_path:attemptPath,reconciliation_outcome:'linked_new_attempt'}});
  }
  return writes;
}
function isComplete(doc,plan,g,review){
  const checkpoint=doc?.import_metadata?.checkpoint;
  return doc?.import_run_id===plan.run_id&&checkpoint?.group_id===g.group_id&&checkpoint?.review_hash===review&&checkpoint?.source_sha256===plan.summary.source_sha256&&checkpoint?.rows===g.rows.length;
}
async function processCompactGroup(db,plan,g,review){
  if(g.action!=='create'||g.before!==null)fail('COMPACT_MODE_REQUIRES_CREATE_ONLY_REVIEW');
  return db.runTransaction(async tx=>{
    const target=db.doc(g.order_path),current=await tx.get(target);
    if(current.exists){
      if(!isComplete(current.data(),plan,g,review))fail('EXISTING_ORDER_REQUIRES_REVIEW');
      return {action:'noop',group_id:g.group_id,rows:g.rows.length,imported_at:current.data().imported_at};
    }
    const byOrder=await tx.get(db.collection('orders').where('payment.cashfree_order_id','==',g.source_order_id));
    if(byOrder.docs.length)fail('CONCURRENT_PROVIDER_MATCH_REQUIRES_REVIEW');
    if(g.source_order_id.startsWith('ord_')){
      const direct=await tx.get(db.doc('orders/'+g.source_order_id.replace(/-r\d+$/,'')));
      if(direct.exists)fail('CONCURRENT_APPLICATION_MATCH_REQUIRES_REVIEW');
    }
    for(const row of g.rows){
      const matches=await tx.get(db.collection('orders').where('payment.cf_payment_id','==',row.normalized.cf_payment_id));
      if(matches.docs.length)fail('CONCURRENT_PAYMENT_MATCH_REQUIRES_REVIEW');
      const attempt=`${g.order_path}/cashfree_payment_attempts/${row.identity_path.split('/').pop()}`;
      for(const p of [row.ledger_path,row.identity_path,attempt])if((await tx.get(db.doc(p))).exists)fail('PAYMENT_IDENTITY_OR_PARTIAL_IMPORT_CONFLICT');
    }
    const time=new Date().toISOString();
    for(const w of writesFor(plan,g,review,time))tx.create(db.doc(w.path),w.data);
    return {action:'create',group_id:g.group_id,rows:g.rows.length,imported_at:time};
  });
}
async function readAll(db,refs){
  const result=new Map();let offset=0,batchSize=100;
  // Sequential bounded batches reduce round trips; reduce size on quota pressure.
  while(offset<refs.length){
    const batch=refs.slice(offset,offset+batchSize).map(p=>db.doc(p));let snapshots;
    for(let retry=0;;retry++){
      try{snapshots=await db.getAll(...batch);break;}
      catch(e){
        if(e.code===8&&batchSize>1){batchSize=Math.max(1,Math.floor(batchSize/2));break;}
        if(![8,14].includes(e.code)||retry>=5)throw e;await new Promise(resolve=>setTimeout(resolve,1000*2**retry));
      }
    }
    if(!snapshots){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
    for(const d of snapshots)result.set(d.ref.path,d);
    offset+=batch.length;
    if(offset%1000===0)console.log(JSON.stringify({readback_documents:offset,total:refs.length}));
  }
  return result;
}
async function verifyCompact(db,plan,review,approvedAddresses=null){
  if(approvedAddresses&&approvedAddresses.source_order_plan_sha256!==review)fail('ADDRESS_PLAN_IMPORT_HASH_MISMATCH');
  const addresses=new Map((approvedAddresses?.assignments||[]).map(a=>[a.order_path,a]));
  const refs=plan.groups.flatMap(g=>[g.order_path,...g.rows.flatMap(r=>[r.ledger_path,r.identity_path,`${g.order_path}/cashfree_payment_attempts/${r.identity_path.split('/').pop()}`])]);
  const snaps=await readAll(db,refs),identities=new Set();
  const report={mode:'compact_live_readback',groups:0,rows:0,success_rows:0,success_minor:0,exceptions:[],plan_sha256:review,run_id:plan.run_id};
  for(const g of plan.groups){
    const order=snaps.get(g.order_path);
    if(!order?.exists||!isComplete(order.data(),plan,g,review)){report.exceptions.push({group_id:g.group_id,reason:'missing_order_or_checkpoint'});continue;}
    const expected=writesFor(plan,g,review,order.data().imported_at);
    const actualOrder=plain(order.data()),address=addresses.get(g.order_path);
    if(address){
      const assignment=actualOrder.billing_address_assignment;
      if(!assignment||assignment.run_id!==approvedAddresses.run_id||assignment.source_sha256!==approvedAddresses.source_sha256||!isDeepStrictEqual(actualOrder.billing_address,address.billing_address))report.exceptions.push({group_id:g.group_id,reason:'approved_address_assignment_mismatch'});
      else{
        if(assignment.before?.billing_address_exists)actualOrder.billing_address=assignment.before.billing_address;
        else delete actualOrder.billing_address;
        if(assignment.before?.assignment_exists)actualOrder.billing_address_assignment=assignment.before.billing_address_assignment;
        else delete actualOrder.billing_address_assignment;
      }
    }
    const orderMatches=isDeepStrictEqual(actualOrder,expected[0].data);
    if(!orderMatches)report.exceptions.push({group_id:g.group_id,reason:'order_mismatch'});
    report.groups++;
    const amount=g.rows.filter(r=>r.normalized.original_status==='SUCCESS').reduce((sum,r)=>sum+r.normalized.money.Amount.minor,0);
    if(order.data().payment.amount_paid_minor!==amount||order.data().fulfillment.due||order.data().tracking.active)report.exceptions.push({group_id:g.group_id,reason:'paid_total_or_effects_mismatch'});
    for(const row of g.rows){
      const actual=expected.filter(w=>[row.ledger_path,row.identity_path,`${g.order_path}/cashfree_payment_attempts/${row.identity_path.split('/').pop()}`].includes(w.path));
      if(actual.some(w=>!snaps.get(w.path)?.exists||!isDeepStrictEqual(plain(snaps.get(w.path).data()),w.data))){report.exceptions.push({source_position:row.source_position,reason:'source_ledger_attempt_or_identity_mismatch'});continue;}
      if(identities.has(row.identity_path))report.exceptions.push({source_position:row.source_position,reason:'duplicate_payment_identity'});
      identities.add(row.identity_path);report.rows++;
      if(row.normalized.original_status==='SUCCESS'){report.success_rows++;report.success_minor+=row.normalized.money.Amount.minor;}
    }
  }
  report.ok=report.exceptions.length===0&&report.groups===plan.summary.controls.orders&&report.rows===plan.summary.controls.rows&&report.success_rows===plan.summary.controls.statuses.SUCCESS&&report.success_minor===plan.summary.controls.success_minor;
  report.verified_at=new Date().toISOString();return report;
}
async function rollbackCompactGroup(db,plan,g,review){
  const marker=db.doc(`cashfree_import_runs/${plan.run_id}/rollback_events/${g.group_id}`);
  return db.runTransaction(async tx=>{
    if((await tx.get(marker)).exists)return {action:'noop',group_id:g.group_id};
    const order=await tx.get(db.doc(g.order_path));
    if(!order.exists||!isComplete(order.data(),plan,g,review))fail('ROLLBACK_ORDER_OR_CHECKPOINT_MISMATCH');
    const writes=writesFor(plan,g,review,order.data().imported_at).filter(w=>w.rollback);
    for(const w of writes){const current=await tx.get(db.doc(w.path));if(!current.exists||!isDeepStrictEqual(plain(current.data()),w.data))fail('ROLLBACK_DOCUMENT_MODIFIED');}
    for(const w of writes)tx.delete(db.doc(w.path));
    tx.create(marker,{group_id:g.group_id,import_run_id:plan.run_id,plan_sha256:review,rolled_back_at:new Date().toISOString(),deleted_paths:writes.map(w=>w.path),immutable_source_ledgers_retained:true});
    return {action:'rollback',group_id:g.group_id};
  });
}
async function main(argv=process.argv.slice(2)){
  const args={};for(let i=0;i<argv.length;i++)args[argv[i].slice(2)]=['--apply','--verify','--rollback'].includes(argv[i])?true:argv[++i];
  const bytes=fs.readFileSync(args.plan),plan=JSON.parse(bytes),review=sha(bytes),out=args.out||path.dirname(args.plan);
  if(sha(fs.readFileSync(path.join(path.dirname(args.plan),'source.csv')))!==plan.summary.source_sha256)fail('SOURCE_ARCHIVE_CHECKSUM_MISMATCH');
  if(plan.groups.some(g=>g.action!=='create'||g.before!==null))fail('COMPACT_MODE_REQUIRES_CREATE_ONLY_REVIEW');
  if(!args.apply&&!args.verify){console.log(JSON.stringify({mode:'dry-run',reviewed_plan_sha256:review,orders:plan.groups.length,source_rows:plan.summary.controls.rows,document_writes:1+plan.groups.length+3*plan.summary.controls.rows,layout:'order_embedded_checkpoint_private_rollback_manifest',rollback_requested:!!args.rollback}));return;}
  if(args.apply&&args['reviewed-sha256']!==review)fail('REVIEWED_PLAN_SHA256_REQUIRED');
  if(args.apply){
    const s=JSON.parse(fs.readFileSync(args.safety));
    if(s.project!==plan.summary.project||s.database!==plan.summary.database||s.plan_sha256!==review||s.source_sha256!==plan.summary.source_sha256||s.client_rules_deny_all!==true||s.automatic_effects_excluded!==true||!s.evidence||!Number.isFinite(Date.parse(s.verified_at))||Date.now()-Date.parse(s.verified_at)>3600000||Date.parse(s.verified_at)>Date.now()+60000)fail('CURRENT_SAFETY_EVIDENCE_REQUIRED');
  }
  const credential=JSON.parse(fs.readFileSync(args.credential));
  if(credential.project_id!=='crestus-6f962'||plan.summary.project!==credential.project_id||plan.summary.database!=='(default)')fail('WRONG_FIREBASE_TARGET');
  const backend=path.resolve(args.backend),admin=require(path.join(backend,'node_modules/firebase-admin'));
  const {GoogleAuth}=require(path.join(backend,'node_modules/google-auth-library'));
  const auth=await new GoogleAuth({credentials:credential,scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const metadata=(await auth.request({url:`https://firestore.googleapis.com/v1/projects/${credential.project_id}/databases/(default)`})).data;
  if(metadata.name!==`projects/${credential.project_id}/databases/(default)`||metadata.type!=='FIRESTORE_NATIVE')fail('DATABASE_IDENTITY_NOT_VERIFIED');
  const app=admin.initializeApp({projectId:credential.project_id,credential:admin.credential.cert(credential)},'compact-cashfree-history'),db=admin.firestore(app);
  db.settings({preferRest:true});
  const approvedAddresses=args['approved-address-plan']?JSON.parse(fs.readFileSync(args['approved-address-plan'])):null;
  if(approvedAddresses&&approvedAddresses.source_order_plan_sha256!==review)fail('ADDRESS_PLAN_IMPORT_HASH_MISMATCH');
  const approvedAddressRows=new Map((approvedAddresses?.assignments||[]).map(a=>[a.order_path,a]));
  try{
    let written=0,outcomes=[];
    if(args.rollback&&args.apply){
      const runRef=db.doc('cashfree_import_runs/'+plan.run_id);
      await db.runTransaction(async tx=>{const r=await tx.get(runRef);if(!r.exists||r.data().review_hash!==review||r.data().layout!=='compact_v1')fail('ROLLBACK_RUN_MISMATCH');if(!r.data().rollback_started_at)tx.update(runRef,{rollback_started_at:new Date().toISOString()});});
      for(const g of plan.groups){outcomes.push(await rollbackCompactGroup(db,plan,g,review));privateWrite(path.join(out,'compact-rollback-outcomes.json'),outcomes);}
      console.log(JSON.stringify({rolled_back_groups:outcomes.filter(o=>o.action==='rollback').length,audit_ledgers_retained:true}));return;
    }
    if(args.apply){
      const runRef=db.doc('cashfree_import_runs/'+plan.run_id);
      const newRun=await db.runTransaction(async tx=>{const snap=await tx.get(runRef);if(snap.exists){if(snap.data().rollback_started_at)fail('ROLLED_BACK_RUN_CLOSED');if(snap.data().review_hash!==review||snap.data().layout!=='compact_v1')fail('RUN_PLAN_OR_LAYOUT_CONFLICT');return false;}
        tx.create(runRef,{import_run_id:plan.run_id,review_hash:review,source_sha256:plan.summary.source_sha256,project:credential.project_id,database:'(default)',layout:'compact_v1',source:'cashfree_transaction_report_csv',source_filename:plan.summary.source_filename,controls:plan.summary.controls,started_at:new Date().toISOString()});return true;});
      if(newRun)written++;
      // Resume/rerun reads all order checkpoints once. A clean first run avoids this extra query.
      const completed=new Map();
      if(!newRun){const snap=await db.collection('orders').where('import_run_id','==',plan.run_id).get();for(const d of snap.docs)completed.set(d.ref.path,d.data());}
      let cursor=0,halt=false;
      const work=async()=>{while(!halt&&cursor<plan.groups.length){const index=cursor++,g=plan.groups[index];
        try{
          const previous=completed.get(g.order_path);
          const original=previous?plain(previous):null,address=approvedAddressRows.get(g.order_path),assignment=original?.billing_address_assignment;
          if(address&&assignment?.run_id===approvedAddresses.run_id&&assignment.source_sha256===approvedAddresses.source_sha256&&isDeepStrictEqual(original.billing_address,address.billing_address)){
            if(assignment.before?.billing_address_exists)original.billing_address=assignment.before.billing_address;else delete original.billing_address;
            if(assignment.before?.assignment_exists)original.billing_address_assignment=assignment.before.billing_address_assignment;else delete original.billing_address_assignment;
          }
          let result;
          if(previous&&isComplete(previous,plan,g,review)&&isDeepStrictEqual(original,writesFor(plan,g,review,previous.imported_at)[0].data))result={action:'noop',group_id:g.group_id,rows:g.rows.length,imported_at:previous.imported_at};
          else result=await processCompactGroup(db,plan,g,review);
          outcomes[index]=result;if(result.action==='create')written+=1+3*g.rows.length;
        }catch(e){outcomes[index]={action:'exception',group_id:g.group_id,source_positions:g.rows.map(r=>r.source_position),code:e.code||'TRANSACTION_ERROR',message:String(e.message||'').slice(0,300)};halt=true;}
        privateWrite(path.join(out,'compact-outcomes.json'),outcomes.filter(Boolean));
        if(outcomes.filter(Boolean).length%100===0)console.log(JSON.stringify({processed_groups:outcomes.filter(Boolean).length,document_writes:written,exceptions:outcomes.filter(o=>o?.action==='exception').length}));
      }};
      await Promise.all([work(),work(),work(),work()]);
      for(let i=0;i<plan.groups.length;i++)if(!outcomes[i])outcomes[i]={action:'not_attempted_after_error',group_id:plan.groups[i].group_id,source_positions:plan.groups[i].rows.map(r=>r.source_position)};
      privateWrite(path.join(out,'compact-outcomes.json'),outcomes);
      const manifest={run_id:plan.run_id,plan_sha256:review,layout:'compact_v1',source_sha256:plan.summary.source_sha256,project:credential.project_id,database:'(default)',audit_ledgers_retained_on_rollback:true,groups:[]};
      for(let i=0;i<plan.groups.length;i++){const result=outcomes[i];if(!['create','noop'].includes(result.action))continue;manifest.groups.push({group_id:result.group_id,imported_at:result.imported_at,documents:writesFor(plan,plan.groups[i],review,result.imported_at).filter(w=>w.rollback).map(w=>({path:w.path,after_sha256:sha(JSON.stringify(w.data))}))});}
      privateWrite(path.join(out,'compact-rollback-manifest.json'),manifest);
      const summary={run_id:plan.run_id,plan_sha256:review,actions:outcomes.reduce((s,o)=>(s[o.action]=(s[o.action]||0)+1,s),{}),document_writes:written,completed_at:new Date().toISOString()};
      privateWrite(path.join(out,written?'compact-apply-summary.json':'compact-rerun-summary.json'),summary);console.log(JSON.stringify(summary));
      if(halt){process.exitCode=1;return;}
    }
    const prior=path.join(out,'compact-readback-verification.json');
    if(args.apply&&written===0&&fs.existsSync(prior)){
      const r=JSON.parse(fs.readFileSync(prior));if(r.ok&&r.plan_sha256===review){console.log(JSON.stringify({no_op_rerun:true,document_writes:0,checked_order_checkpoints:outcomes.length,prior_full_readback_verified_at:r.verified_at}));return;}
    }
    const report=await verifyCompact(db,plan,review,approvedAddresses);
    if(approvedAddresses)report.approved_address_plan_sha256=sha(fs.readFileSync(args['approved-address-plan']));
    privateWrite(prior,report);console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
  }finally{await app.delete();}
}
module.exports={writesFor,isComplete,processCompactGroup,verifyCompact,readAll,rollbackCompactGroup};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({error:e.code||'IMPORT_FAILED',message:String(e.message||'').slice(0,250)}));process.exitCode=1;});
