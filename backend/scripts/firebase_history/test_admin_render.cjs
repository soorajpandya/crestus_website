// Render the actual admin components in a DOM with synthetic data and mocked auth/API.
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]);
const deps=path.join(root,'frontend/node_modules');
const React=require(path.join(deps,'react'));
const {JSDOM}=require(path.join(deps,'jsdom'));
const {createRoot}=require(path.join(deps,'react-dom/client'));
const babel=require(path.join(deps,'@babel/core'));
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/admin/orders/ord_cf_test'});
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT=true;
const order={order_id:'ord_cf_test',record_kind:'historical_wallet_deposit',description:'Wallet deposit synthetic',source:'cashfree_transaction_report_csv',created_at:null,imported_at:'2026-10-15T12:00:00Z',source_row_refs:['ledger/1'],customer:{name:'Synthetic customer',email:'test@example.invalid',phone:'0000000000'},package:null,items:[],totals:{total:100,shipping:null,subtotal:null,discount:null,tax_included:null},payment:{status:'paid',amount_paid:100,cashfree_order_id:'source_test',cf_payment_id:'0001',refunds:[],settlement_status_counts:{NOT_SETTLED:1}},fulfillment:{status:'not_applicable',history:[]},shipment:{},tracking:{events:[]},import_metadata:{side_effects_disabled:true}};
const api={get:async url=>({data:url==='/admin/orders'?[order]:order}),post:async()=>{assert.fail('Render must not submit payment or shipping actions');}};
const router={Link:({to,children,...props})=>React.createElement('a',{href:to,...props},children),useNavigate:()=>()=>{},useParams:()=>({order_id:'ord_cf_test'})};
const cache=new Map();
function load(file){
  file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;
  const source=fs.readFileSync(file,'utf8');
  const code=babel.transformSync(source,{presets:[[require(path.join(deps,'@babel/preset-env')),{targets:{node:'current'}}],[require(path.join(deps,'@babel/preset-react')),{runtime:'automatic'}]],configFile:false,babelrc:false,filename:file}).code;
  const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,m);
  const original=m.require.bind(m);
  m.require=id=>{
    if(id==='react-router-dom')return router;
    if(id.endsWith('/lib/api')||id==='./api')return {__esModule:true,default:api,apiErrorMessage:()=>{throw Error('Unexpected API error');}};
    if(id.endsWith('/context/AuthContext'))return {useAuth:()=>({user:{uid:'synthetic-admin'},loading:false,isAdmin:true})};
    if(id.endsWith('/lib/orderUi'))return load(path.join(root,'frontend/src/lib/orderUi.js'));
    if(id.endsWith('/lib/adminUi'))return load(path.join(root,'frontend/src/lib/adminUi.js'));
    if(id.endsWith('/components/OrderBits'))return load(path.join(root,'frontend/src/components/OrderBits.jsx'));
    return original(id);
  };
  m._compile(code,file);return m.exports;
}
async function main(){
  const {AdminOrderDetail,AdminOrders}=load(path.join(root,'frontend/src/pages/AdminOrders.jsx'));
  const ui=load(path.join(root,'frontend/src/lib/orderUi.js'));
  assert.equal(ui.inr(null),'Unknown');assert.equal(ui.inr('paid'),'Unknown');assert.equal(ui.inr(0),'₹0');
  const container=document.querySelector('#root'),view=createRoot(container);
  await React.act(async()=>view.render(React.createElement(AdminOrderDetail)));
  assert(container.querySelector('[data-testid="historical-import-notice"]'));
  assert(container.textContent.includes('Wallet deposit synthetic'));
  assert(container.textContent.includes('not settled: 1'));
  assert(container.textContent.includes('Unknown'));
  assert(!container.textContent.includes('preparing your shipment'));
  const actions=[...container.querySelectorAll('button')].filter(b=>/Re-verify|Refund|Cancel shipment/.test(b.textContent));
  assert.equal(actions.length,3);assert(actions.every(b=>b.disabled));
  await React.act(async()=>view.render(React.createElement(AdminOrders)));
  assert(container.textContent.includes('Historical wallet deposit'));
  assert(container.textContent.includes('Creation time unknown'));
  assert(!container.textContent.includes('Invalid Date'));
  await React.act(async()=>view.unmount());
  console.log('Admin list/detail DOM render passed: null fields, truthful provenance, unsettled paid status, disabled actions, unknown amounts.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
