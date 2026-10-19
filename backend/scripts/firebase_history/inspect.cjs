// Read-only inspection. All document data stays in a private, ignored directory.
const fs = require('node:fs');
const path = require('node:path');
const backend = process.argv[2];
const root = process.argv[3];
const reference = process.argv[4];
const admin = require(path.join(backend, 'node_modules/firebase-admin'));
const {GoogleAuth} = require(path.join(backend, 'node_modules/google-auth-library'));
async function main() {
  const credential = JSON.parse(fs.readFileSync(path.join(root, 'service-account.json')));
  if (credential.project_id !== 'crestus-6f962') throw Error('Wrong credential project');
  const app = admin.initializeApp({credential: admin.credential.cert(credential), projectId: credential.project_id});
  const db = admin.firestore(app);
  const snapshot = await db.collection('orders').get();
  const orders = snapshot.docs.map(d => ({path:d.ref.path, update_time:d.updateTime.toDate().toISOString(), data:d.data()}));
  fs.writeFileSync(path.join(root, 'existing-orders.json'), JSON.stringify(orders, null, 2), {mode:0o600});
  console.log(JSON.stringify({orders:orders.length, reference_exists:reference?orders.some(d=>d.path==='orders/'+reference):undefined, invalid_amount_paid:orders.filter(d=>typeof d.data.payment?.amount_paid==='string' && !/^\d+(\.\d+)?$/.test(d.data.payment.amount_paid)).length}));
  const client = await new GoogleAuth({credentials:credential, scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const inventory = {};
  for (const [name,url] of Object.entries({
    functions_v1:'https://cloudfunctions.googleapis.com/v1/projects/crestus-6f962/locations/-/functions',
    eventarc:'https://eventarc.googleapis.com/v1/projects/crestus-6f962/locations/-/triggers',
    firestore_rules:'https://firebaserules.googleapis.com/v1/projects/crestus-6f962/releases/cloud.firestore',
  })) {
    try { const r=await client.request({url}); inventory[name]={ok:true, data:r.data}; }
    catch(e) { inventory[name]={ok:false, status:e.response?.status, reason:e.response?.data?.error?.status,details:e.response?.data?.error?.details?.map(d=>({reason:d.reason,domain:d.domain}))}; }
  }
  if(inventory.firestore_rules?.ok && inventory.firestore_rules.data.rulesetName) {
    try {const r=await client.request({url:'https://firebaserules.googleapis.com/v1/'+inventory.firestore_rules.data.rulesetName});inventory.active_ruleset={ok:true,data:r.data};}
    catch(e){inventory.active_ruleset={ok:false,status:e.response?.status,reason:e.response?.data?.error?.status};}
  }
  fs.writeFileSync(path.join(root,'trigger-inventory.json'),JSON.stringify(inventory,null,2),{mode:0o600});
  console.log(JSON.stringify(Object.fromEntries(Object.entries(inventory).map(([k,v])=>[k,{ok:v.ok,status:v.status,count:(v.data?.functions||v.data?.triggers||[]).length}]))));
  await app.delete();
}
main().catch(e=>{console.error(JSON.stringify({error:'Read-only inspection failed',code:e.code||e.response?.status||'unknown'}));process.exitCode=1;});
