#!/usr/bin/env node
// Read-only live boundary checks. Never writes to Firestore or billing settings.
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
async function main(){
  const backend=path.resolve(process.argv[2]),root=path.resolve(process.argv[3]);
  const credential=JSON.parse(fs.readFileSync(path.join(root,'service-account.json')));
  if(credential.project_id!=='crestus-6f962')throw Error('WRONG_PROJECT');
  const admin=require(path.join(backend,'node_modules/firebase-admin'));
  const {GoogleAuth}=require(path.join(backend,'node_modules/google-auth-library'));
  const plan=JSON.parse(fs.readFileSync(path.join(root,'preview/plan.json')));
  const baseline=JSON.parse(fs.readFileSync(path.join(root,'existing-orders.json')));
  const app=admin.initializeApp({projectId:credential.project_id,credential:admin.credential.cert(credential)},'historical-final-audit');
  const db=admin.firestore(app);db.settings({preferRest:true});
  try{
    const old=await db.getAll(...baseline.map(o=>db.doc(o.path)));
    const originals=baseline.map((before,i)=>({path:before.path,exists:old[i].exists,unchanged:old[i].exists&&isDeepStrictEqual(JSON.parse(JSON.stringify(old[i].data())),before.data),update_time_unchanged:old[i].exists&&old[i].updateTime.toDate().toISOString()===before.update_time}));
    const imported=await db.collection('orders').where('import_run_id','==',plan.run_id).get();
    const total=(await db.collection('orders').count().get()).data().count;
    const {toAdminView}=require(path.join(backend,'lib/orders.js'));
    let effects=0,rendered=0;
    for(const d of imported.docs){const order=d.data();if(order.payment?.status==='pending'||order.fulfillment?.due||order.tracking?.active)effects++;JSON.stringify(toAdminView(order));rendered++;}
    const client=await new GoogleAuth({credentials:credential,scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
    const release=(await client.request({url:'https://firebaserules.googleapis.com/v1/projects/crestus-6f962/releases/cloud.firestore'})).data;
    const ruleset=(await client.request({url:'https://firebaserules.googleapis.com/v1/'+release.rulesetName})).data;
    const rules=ruleset.source.files.map(f=>f.content).join('\n');
    const clauses=[...rules.matchAll(/allow\s+[^:]+:\s*if\s+([^;]+);/g)];
    const denyAll=clauses.length>0&&clauses.every(c=>c[1].trim()==='false');
    const health=(await client.request({url:'https://crestus-api.onrender.com/api/health'})).data;
    const report={project:credential.project_id,database:'(default)',total_orders:total,imported_orders:imported.size,original_orders:originals,automatic_job_eligible_imports:effects,local_admin_view_serialized:rendered,client_rules_deny_all:!!denyAll,ruleset:release.rulesetName,live_health:health,verified_at:new Date().toISOString()};
    report.ok=total===3508&&imported.size===3504&&originals.length===4&&originals.every(o=>o.unchanged&&o.update_time_unchanged)&&effects===0&&rendered===3504&&!!denyAll;
    fs.writeFileSync(path.join(root,'preview/final-boundary-verification.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
  }finally{await app.delete();}
}
main().catch(e=>{console.error(JSON.stringify({error:e.code||'FINAL_AUDIT_FAILED',message:String(e.message).slice(0,250)}));process.exitCode=1;});
