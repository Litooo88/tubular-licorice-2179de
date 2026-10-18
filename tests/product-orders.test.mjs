import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createInternalCase}=require('../netlify/functions/_shared/internal-case.js');
const {ensureProductOrder,orderCaseId}=require('../netlify/functions/_shared/product-order.js');
const memoryStore=()=>{
  const rows=new Map();return {rows,
    async get(key){return structuredClone(rows.get(key)||null);},
    async setJSON(key,value,options={}){if(options.onlyIfNew&&rows.has(key))return {modified:false};rows.set(key,structuredClone(value));return {modified:true};},
  };
};
const session=()=>({id:'cs_test_example123',payment_status:'paid',amount_total:899000,currency:'sek',customer_details:{email:'customer@example.com',phone:'+46700000000'},collected_information:{shipping_details:{name:'Test Kund',address:{city:'Teststad',country:'SE'}}},metadata:{product_id:'navee-st3',product_name:'NAVEE ST3',brand:'NAVEE'},payment_intent:'pi_example',payment_method_types:['klarna']});
test('concurrent Stripe replays create exactly one case and preserve later staff edits',async()=>{
 const store=memoryStore(),indexStore=memoryStore();
 const results=await Promise.all(Array.from({length:5},()=>ensureProductOrder({session:session(),store,indexStore})));
 assert.equal(results.filter(r=>r.created).length,1);assert.equal(store.rows.size,1);
 const item=results[0].case;assert.equal(item.customer.name,'Test Kund');assert.equal(item.payment.amount,8990);assert.equal(item.payment.status,'paid');assert.equal(item.notifications.thankYou.status,'suppressed');
 item.status='waiting_customer';item.notes=[{text:'Ny anteckning'}];await store.setJSON(item.id,item);
 assert.deepEqual((await ensureProductOrder({session:session(),store,indexStore})).case,item);
});
test('unpaid, missing product and wrong currency do not create a case',async()=>{
 for(const change of [{payment_status:'unpaid'},{currency:'eur'},{metadata:{}},{amount_total:-1}]){
  const store=memoryStore(),indexStore=memoryStore();await assert.rejects(ensureProductOrder({session:{...session(),...change},store,indexStore}));assert.equal(store.rows.size,0);assert.equal(indexStore.rows.size,0);
 }
});
test('manual retry and dry run do not duplicate or mark paid',async()=>{
 const store=memoryStore(),indexStore=memoryStore(),body={customerName:'Test Kund',customerEmail:'customer@example.com',totalCost:8990,caseType:'product_order'};
 const dry=await createInternalCase({store,indexStore,body,key:'manual:example',dryRun:true});assert.equal(dry.dryRun,true);assert.equal(store.rows.size,0);assert.equal(indexStore.rows.size,0);
 const first=await createInternalCase({store,indexStore,body,key:'manual:example'});const next=await createInternalCase({store,indexStore,body,key:'manual:example'});
 assert.equal(first.created,true);assert.equal(next.created,false);assert.equal(first.case.payment.status,'unpaid');assert.equal(first.case.caseType,'product_order');assert.deepEqual(first.case.notifications,{});
});
test('storage errors fail closed instead of overwriting existing data',async()=>{
 await assert.rejects(createInternalCase({store:{get:async()=>{throw Error('offline');}},indexStore:memoryStore(),body:{customerName:'Test'},key:'same'}),/offline/);
});
function webhookHarness(){
 const stores=new Map();const getStore=({name})=>{if(!stores.has(name))stores.set(name,memoryStore());return stores.get(name);};let sends=0;
 const settings={STRIPE_SECRET_KEY:'sk_test_unit',STRIPE_WEBHOOK_SECRET:'whsec_unit',WORKSHOP_EMAIL:'',NOTIFY_EMAIL:''};
 const mod={exports:{}};
 const context={module:mod,exports:mod.exports,Buffer,console,Date,
  require:(name)=>{
   if(name==='stripe')return ()=>({webhooks:{constructEvent:(raw,signature)=>{if(signature!=='valid')throw Error('invalid');return JSON.parse(raw);}}});
   if(name==='@netlify/blobs')return {getStore};
   if(name==='./_shared/storage')return {connectBlobs(){}};
   if(name==='./_shared/http')return {...require('../netlify/functions/_shared/http.js'),env:(key)=>settings[key]||''};
   if(name==='./_shared/email')return {FOOTER_HTML:'',FOOTER_TEXT:'',resendEmail:async()=>{sends++;return {status:'sent',id:'mail_unit'};}};
   if(name==='./_shared/product-order')return require('../netlify/functions/_shared/product-order.js');
   throw Error(name);
  }};
 vm.runInNewContext(fs.readFileSync(new URL('../netlify/functions/stripe-webhook.js',import.meta.url),'utf8'),context);
 const call=(type='checkout.session.completed',obj=session(),signature='valid')=>mod.exports.handler({httpMethod:'POST',headers:{'stripe-signature':signature},body:JSON.stringify({id:'evt_example',type,data:{object:obj}})});
 return {call,stores,getStore,sends:()=>sends};
}
test('webhook verifies signature and handles delayed success without notifications for unpaid sessions',async()=>{
 const h=webhookHarness();assert.equal((await h.call(undefined,undefined,'invalid')).statusCode,400);assert.equal(h.stores.size,0);
 await h.call('checkout.session.completed',{...session(),payment_status:'unpaid'});assert.equal(h.sends(),0);
 assert.equal((await h.call('checkout.session.async_payment_succeeded')).statusCode,200);assert.equal(h.sends(),1);
 await Promise.all([h.call(),h.call('checkout.session.async_payment_succeeded')]);assert.equal(h.sends(),1);
 assert.equal(h.getStore({name:'workshop-cases'}).rows.size,1);
});
test('old sent confirmation remains sent and is not resent during replay',async()=>{
 const h=webhookHarness();await h.getStore({name:'payments'}).setJSON(`stripe_${session().id}`,{notifications:{orderConfirmation:{status:'sent',id:'old_mail'}}});
 await h.call();assert.equal(h.sends(),0);assert.equal(h.getStore({name:'workshop-cases'}).rows.has(orderCaseId(session().id)),true);
});
test('concurrent delivery events claim notifications exactly once',async()=>{
 const h=webhookHarness();await Promise.all(Array.from({length:5},()=>h.call()));assert.equal(h.sends(),1);
});
test('recovered or uncertain notification claims never send again',async()=>{
 for(const status of ['processing','recovered_without_send']){
  const h=webhookHarness();await h.getStore({name:'stripe-order-notifications'}).setJSON(session().id,{status});await h.call();assert.equal(h.sends(),0);
 }
});
test('recovery endpoint requires authentication before Stripe or storage access',async()=>{
 const previous=process.env.ADMIN_TOKEN;process.env.ADMIN_TOKEN='unit-token';
 try{
  const {default:handler}=await import('../netlify/functions/product-orders.mjs');
  const response=await handler(new Request('https://example.com/api/product-orders?sessionId=cs_test_example123'));
  assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
 }finally{if(previous===undefined)delete process.env.ADMIN_TOKEN;else process.env.ADMIN_TOKEN=previous;}
});
