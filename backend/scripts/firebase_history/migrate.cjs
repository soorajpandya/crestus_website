#!/usr/bin/env node
// Run against a reviewed plan. No Firebase writes occur without --apply.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const get = (o,k) => k.split('.').reduce((v,p)=>v?.[p],o);
const fail = code => { const e=new Error(code);e.code=code;throw e; };
const stamp = () => new Date().toISOString();
function writePrivate(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600});
  fs.chmodSync(file,0o600);
}
function documentFor(group,time) {
  const doc=plain(group.proposed);
  doc.imported_at=time;doc.updated_at=time;doc.import_metadata.imported_at=time;
  return doc;
}

async function processGroup(db,plan,group,reviewHash) {
  if (!['create','update'].includes(group.action)) fail('UNRESOLVED_PREVIEW_CONFLICT');
  const run=db.collection('cashfree_import_runs').doc(plan.run_id);
  const checkpoint=run.collection('groups').doc(group.group_id);
  const target=db.doc(group.order_path);
  const mapping=db.doc(group.identity_path);
  return db.runTransaction(async tx=>{
    const done=await tx.get(checkpoint);
    if(done.exists) {
      if(done.data().source_sha256!==plan.summary.source_sha256 || done.data().review_hash!==reviewHash) fail('CHECKPOINT_PLAN_MISMATCH');
      return {action:'noop',group_id:group.group_id,rows:group.rows.length};
    }
    const runSnapshot=await tx.get(run);
    if(runSnapshot.exists && (runSnapshot.data().review_hash!==reviewHash || runSnapshot.data().source_sha256!==plan.summary.source_sha256))fail('RUN_PLAN_MISMATCH');
    const existing=await tx.get(target);
    const identity=await tx.get(mapping);
    const sourceId=group.source_order_id;
    // A query in the same serializable transaction catches new provider matches.
    // The existing application's webhook only updates orders; it does not create them.
    const byOrder=await tx.get(db.collection('orders').where('payment.cashfree_order_id','==',sourceId));
    const direct=await tx.get(db.collection('orders').doc(sourceId.replace(/-r\d+$/,'')));
    const paths=new Set(byOrder.docs.map(d=>d.ref.path));
    if(direct.exists) paths.add(direct.ref.path);
    for(const row of group.rows) {
      const byPayment=await tx.get(db.collection('orders').where('payment.cf_payment_id','==',row.normalized.cf_payment_id));
      byPayment.docs.forEach(d=>paths.add(d.ref.path));
    }
    if([...paths].some(p=>p!==group.order_path)) fail('CONCURRENT_PROVIDER_MATCH_REQUIRES_REVIEW');
    if(identity.exists && identity.data().order_path!==group.order_path) fail('ORDER_IDENTITY_CONFLICT');
    if(group.action==='create' && existing.exists) fail('TARGET_ALREADY_EXISTS_REQUIRES_REVIEW');
    if(group.action==='update' && (!existing.exists || !isDeepStrictEqual(plain(existing.data()),group.before))) fail('EXISTING_DOCUMENT_CHANGED_REQUIRES_REVIEW');
    const rows=[];
    for(const row of group.rows) {
      const ledger=db.doc(row.ledger_path),claim=db.doc(row.identity_path);
      const attempt=target.collection('cashfree_payment_attempts').doc(row.identity_path.split('/').pop());
      const ls=await tx.get(ledger),cs=await tx.get(claim),as=await tx.get(attempt);
      if(ls.exists) fail('LEDGER_WITHOUT_CHECKPOINT_REQUIRES_REVIEW');
      if(cs.exists && (cs.data().order_path!==group.order_path || cs.data().amount_minor!==row.normalized.money.Amount.minor || cs.data().currency!==row.normalized.currency)) fail('PAYMENT_IDENTITY_CONFLICT');
      if(as.exists && (!cs.exists || as.data().normalized.cf_payment_id!==row.normalized.cf_payment_id)) fail('ATTEMPT_IDENTITY_CONFLICT');
      rows.push({row,ledger,claim,attempt,cs,as});
    }
    // All reads precede all writes. No provider, email, wallet or shipment call occurs here.
    const time=stamp(),writes=[];
    if(!runSnapshot.exists)tx.create(run,{import_run_id:plan.run_id,source_sha256:plan.summary.source_sha256,review_hash:reviewHash,project:plan.summary.project,database:plan.summary.database,controls:plan.summary.controls,source_filename:plan.summary.source_filename,started_at:time,source:'cashfree_transaction_report_csv'});
    const auditCreate=(ref,data,rollback=true)=>{
      tx.create(ref,data);
      if(rollback) writes.push({path:ref.path,operation:'create',after:data});
    };
    if(group.action==='create') auditCreate(target,documentFor(group,time));
    else if(Object.keys(group.patch).length) {
      const patch=plain(group.patch);
      if(patch.cashfree_imports?.[plan.run_id])patch.cashfree_imports[plan.run_id].imported_at=time;
      if(patch[`cashfree_imports.${plan.run_id}`])patch[`cashfree_imports.${plan.run_id}`].imported_at=time;
      tx.update(target,patch);
      writes.push({path:target.path,operation:'update',fields:Object.entries(patch).map(([field,after])=>({field,before:get(existing.data(),field)??null,before_exists:get(existing.data(),field)!==undefined,after}))});
    }
    if(!identity.exists) auditCreate(mapping,{order_path:group.order_path,source_order_id:sourceId,merchant_scope:plan.summary.merchant_scope||group.proposed.import_metadata.merchant_scope,import_run_id:plan.run_id,imported_at:time});
    for(const {row,ledger,claim,attempt,cs,as} of rows) {
      const amount=row.normalized.money.Amount.minor;
      if(!cs.exists) auditCreate(claim,{order_path:group.order_path,attempt_path:attempt.path,cf_payment_id:row.normalized.cf_payment_id,amount_minor:amount,currency:row.normalized.currency,import_run_id:plan.run_id,imported_at:time});
      if(!as.exists) auditCreate(attempt,{normalized:row.normalized,source:'cashfree_transaction_report_csv',source_row_refs:[row.ledger_path],import_run_id:plan.run_id,imported_at:time});
      auditCreate(ledger,{...row,source:'cashfree_transaction_report_csv',imported_at:time,order_path:group.order_path,attempt_path:attempt.path,reconciliation_outcome:cs.exists?'linked_existing_attempt':'linked_new_attempt'},false);
    }
    // Full original document is backed up atomically with the field updates.
    auditCreate(run.collection('backups').doc(group.group_id),{order_path:group.order_path,before:existing.exists?existing.data():null,recorded_at:time,writes,import_run_id:plan.run_id},false);
    auditCreate(checkpoint,{group_id:group.group_id,order_path:group.order_path,source_sha256:plan.summary.source_sha256,review_hash:reviewHash,rows:rows.length,outcome:group.action,completed_at:time,import_run_id:plan.run_id},false);
    return {action:group.action,group_id:group.group_id,rows:rows.length};
  });
}

async function verify(db,plan) {
  const report={groups:0,rows:0,success_rows:0,success_minor:0,exceptions:[],order_paths:new Set(),success_identities:new Set()};
  for(const group of plan.groups) {
    const paths=[`cashfree_import_runs/${plan.run_id}/groups/${group.group_id}`,group.order_path,group.identity_path];
    for(const r of group.rows) paths.push(r.ledger_path,r.identity_path,`${group.order_path}/cashfree_payment_attempts/${r.identity_path.split('/').pop()}`);
    const snaps=await db.getAll(...paths.map(p=>db.doc(p)));
    const [checkpoint,order,mapping]=snaps;
    if(!checkpoint.exists || !order.exists || !mapping.exists || mapping.data().order_path!==group.order_path) report.exceptions.push({group_id:group.group_id,reason:'missing_group_order_or_mapping'});
    else {
      report.groups++;report.order_paths.add(group.order_path);
      const sum=group.rows.filter(r=>r.normalized.original_status==='SUCCESS').reduce((s,r)=>s+r.normalized.money.Amount.minor,0);
      if(group.action==='create' && (order.data().payment.amount_paid_minor!==sum || order.data().import_metadata?.side_effects_disabled!==true || order.data().fulfillment?.due || order.data().tracking?.active)) report.exceptions.push({group_id:group.group_id,reason:'order_total_or_side_effect_flag'});
    }
    for(let i=0;i<group.rows.length;i++) {
      const row=group.rows[i],[ledger,claim,attempt]=snaps.slice(3+i*3,6+i*3);
      if(!ledger.exists || !claim.exists || !attempt.exists || ledger.data().row_sha256!==row.row_sha256 || !isDeepStrictEqual(ledger.data().source_columns,row.source_columns) || ledger.data().order_path!==group.order_path || claim.data().order_path!==group.order_path || ledger.data().attempt_path!==attempt.ref.path || !isDeepStrictEqual(plain(attempt.data().normalized),row.normalized)) {
        report.exceptions.push({source_position:row.source_position,reason:'ledger_identity_or_attempt_mismatch'});continue;
      }
      report.rows++;
      if(row.normalized.original_status==='SUCCESS') {
        if(report.success_identities.has(row.identity_path)) report.exceptions.push({source_position:row.source_position,reason:'duplicate_success_identity'});
        report.success_identities.add(row.identity_path);report.success_rows++;report.success_minor+=row.normalized.money.Amount.minor;
      }
    }
  }
  report.unique_orders=report.order_paths.size;report.unique_successes=report.success_identities.size;
  delete report.order_paths;delete report.success_identities;
  report.ok=report.exceptions.length===0 && report.groups===plan.summary.controls.orders && report.rows===plan.summary.controls.rows && report.success_rows===plan.summary.controls.statuses.SUCCESS && report.success_minor===plan.summary.controls.success_minor;
  return report;
}

async function rollbackGroup(db,plan,group,fieldDelete,reviewHash) {
  const base=`cashfree_import_runs/${plan.run_id}`;
  const backupRef=db.doc(`${base}/backups/${group.group_id}`);
  const marker=db.doc(`${base}/rollback_events/${group.group_id}`);
  return db.runTransaction(async tx=>{
    if((await tx.get(marker)).exists)return {action:'noop'};
    const backup=await tx.get(backupRef);
    const cp=await tx.get(db.doc(`${base}/groups/${group.group_id}`));
    if(!backup.exists || !cp.exists || cp.data().review_hash!==reviewHash)fail('ROLLBACK_MANIFEST_MISMATCH');
    const writes=backup.data().writes;
    const current=[];
    for(const w of writes) {
      if(![group.order_path,group.identity_path,...group.rows.flatMap(r=>[r.identity_path,`${group.order_path}/cashfree_payment_attempts/${r.identity_path.split('/').pop()}`])].includes(w.path))fail('ROLLBACK_PATH_OUTSIDE_IMPORT');
      const snap=await tx.get(db.doc(w.path));
      if(!snap.exists)fail('ROLLBACK_DOCUMENT_MISSING');
      const data=plain(snap.data());
      if(w.operation==='create' && (!isDeepStrictEqual(data,w.after) || data.import_run_id!==plan.run_id))fail('ROLLBACK_DOCUMENT_MODIFIED');
      if(w.operation==='update' && w.fields.some(f=>!isDeepStrictEqual(get(data,f.field),f.after)))fail('ROLLBACK_FIELD_MODIFIED');
      current.push(w);
    }
    for(const w of current) {
      if(w.operation==='create')tx.delete(db.doc(w.path));
      else tx.update(db.doc(w.path),Object.fromEntries(w.fields.map(f=>[f.field,f.before_exists?f.before:fieldDelete])));
    }
    tx.create(marker,{import_run_id:plan.run_id,rolled_back_at:stamp(),source_sha256:plan.summary.source_sha256,paths:current.map(w=>w.path)});
    // Original CSV ledgers, backups and checkpoints remain append-only audit history.
    return {action:'rollback',group_id:group.group_id};
  });
}

function validateSafety(safety,plan,reviewHash) {
  if(safety.project!==plan.summary.project || safety.database!==plan.summary.database || safety.plan_sha256!==reviewHash || safety.source_sha256!==plan.summary.source_sha256 || safety.deployed_import_guards_verified!==true || safety.trigger_inventory_verified!==true || safety.private_collections_rules_verified!==true || !safety.evidence || !safety.verified_at || !Number.isFinite(Date.parse(safety.verified_at)) || Date.now()-Date.parse(safety.verified_at)>3600000 || Date.parse(safety.verified_at)>Date.now()+60000) fail('LIVE_SAFETY_VERIFICATION_REQUIRED');
}

async function main(argv=process.argv.slice(2)) {
  const options={};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];if(!key.startsWith('--'))fail('INVALID_ARGUMENT');
    options[key.slice(2)]=['--apply','--verify','--rollback'].includes(key)?true:argv[++i];
  }
  if(!options.plan)fail('PLAN_REQUIRED');
  const bytes=fs.readFileSync(options.plan),plan=JSON.parse(bytes),reviewHash=sha(bytes);
  if(sha(fs.readFileSync(path.join(path.dirname(options.plan),'source.csv')))!==plan.summary.source_sha256)fail('SOURCE_ARCHIVE_CHECKSUM_MISMATCH');
  if(!options.apply && !options.verify) {
    console.log(JSON.stringify({mode:'dry-run',plan_sha256:reviewHash,...plan.summary,rollback_requested:!!options.rollback},null,2));return;
  }
  if(!options.backend || !options.credential)fail('BACKEND_AND_CREDENTIAL_REQUIRED');
  if(options.apply) {
    if(options['reviewed-sha256']!==reviewHash)fail('REVIEWED_PLAN_SHA256_REQUIRED');
    if(!options.safety)fail('LIVE_SAFETY_VERIFICATION_REQUIRED');
    validateSafety(JSON.parse(fs.readFileSync(options.safety)),plan,reviewHash);
  }
  const credential=JSON.parse(fs.readFileSync(options.credential));
  if(credential.project_id!==plan.summary.project || plan.summary.project!=='crestus-6f962' || plan.summary.database!=='(default)')fail('WRONG_FIREBASE_TARGET');
  const admin=require(path.join(path.resolve(options.backend),'node_modules/firebase-admin'));
  const {GoogleAuth}=require(path.join(path.resolve(options.backend),'node_modules/google-auth-library'));
  const auth=await new GoogleAuth({credentials:credential,scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const meta=await auth.request({url:`https://firestore.googleapis.com/v1/projects/${credential.project_id}/databases/(default)`});
  if(meta.data.name!==`projects/${plan.summary.project}/databases/(default)` || meta.data.type!=='FIRESTORE_NATIVE')fail('DATABASE_IDENTITY_NOT_VERIFIED');
  const app=admin.initializeApp({projectId:credential.project_id,credential:admin.credential.cert(credential)},'cashfree-history');
  const db=admin.firestore(app),out=options.out||path.dirname(options.plan);
  try {
    if(options.apply) {
      const outcomes=[];
      for(const group of plan.groups) {
        try {outcomes.push(options.rollback?await rollbackGroup(db,plan,group,admin.firestore.FieldValue.delete(),reviewHash):await processGroup(db,plan,group,reviewHash));}
        catch(e) {outcomes.push({group_id:group.group_id,action:'exception',code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'TRANSACTION_ERROR',source_positions:group.rows.map(r=>r.source_position)});}
        writePrivate(path.join(out,'outcomes.json'),outcomes);
        if(outcomes.length%100===0)console.log(JSON.stringify({processed_groups:outcomes.length,exceptions:outcomes.filter(o=>o.action==='exception').length}));
      }
      writePrivate(path.join(out,'rollback-manifest.json'),{run_id:plan.run_id,plan_sha256:reviewHash,project:plan.summary.project,database:plan.summary.database,backup_collection:`cashfree_import_runs/${plan.run_id}/backups`,groups:outcomes.filter(o=>['create','update','noop'].includes(o.action)).map(o=>o.group_id),audit_ledger_retained_on_rollback:true});
      if(outcomes.some(o=>o.action==='exception'))process.exitCode=1;
    }
    if(!options.rollback) {
      const report=await verify(db,plan);writePrivate(path.join(out,'readback-verification.json'),report);
      console.log(JSON.stringify({readback_ok:report.ok,groups:report.groups,rows:report.rows,success_minor:report.success_minor,exception_count:report.exceptions.length}));
      if(!report.ok)process.exitCode=1;
    }
  } finally {await app.delete();}
}

module.exports={processGroup,verify,rollbackGroup,validateSafety,documentFor,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({error:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'IMPORT_FAILED',details:'Sensitive details suppressed; no credentials or payment values logged.'}));process.exitCode=1;});
