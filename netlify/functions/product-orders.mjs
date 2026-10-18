import Stripe from 'stripe';
import { getStore } from '@netlify/blobs';
import { requireAdminToken } from './_shared/admin-auth.mjs';
import http from './_shared/http.js';
import orders from './_shared/product-order.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export default async (request) => {
  const auth=requireAdminToken(request,json);
  if (!auth.ok) return auth.response;
  if (!['GET','POST'].includes(request.method)) return json({error:'Method not allowed'},405);
  const body=request.method==='POST'?await request.json().catch(()=>null):{};
  if (!body) return json({error:'Ogiltig JSON'},400);
  const sessionId=http.clean(request.method==='GET'?new URL(request.url).searchParams.get('sessionId'):body.sessionId,180);
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return json({error:'Ange fullständig Checkout-session (cs_live_...).'},400);
  const secret=http.env('STRIPE_SECRET_KEY');
  if (!secret) return json({error:'Stripe är inte konfigurerat.',configured:false},503);
  try {
    const stripe=new Stripe(secret);
    const session=await stripe.checkout.sessions.retrieve(sessionId);
    const store=getStore({name:'workshop-cases',consistency:'strong'});
    const indexStore=getStore({name:'service-number-index',consistency:'strong'});
    const id=orders.orderCaseId(sessionId);
    const existing=await store.get(id,{type:'json'});
    const payment=await getStore({name:'payments',consistency:'strong'}).get(`stripe_${sessionId}`,{type:'json'});
    const delivery=await getStore({name:'stripe-order-notifications',consistency:'strong'}).get(sessionId,{type:'json'});
    const preview=orders.orderBody(session);
    if(request.method==='GET'||body.dryRun===true) return json({ok:true,dryRun:true,preview,case:existing,notifications:delivery?.results||payment?.notifications||{},notificationState:delivery?.status||'unknown',sentNow:false});
    const result=await orders.ensureProductOrder({session,store,indexStore});
    // A recovered order may already have been confirmed manually. Block later
    // webhook replays from creating a second confirmation; keep legacy facts.
    await getStore({name:'stripe-order-notifications',consistency:'strong'}).setJSON(sessionId,{
      status:'recovered_without_send',results:payment?.notifications||{},recoveredAt:new Date().toISOString(),
    },{onlyIfNew:true});
    const note=http.clean(body.note,2000);
    if(note){
      // Immutable event keyed to the session: repeated recovery is safe and
      // never performs read/modify/write against a staff-edited case blob.
      await getStore({name:'case-events',consistency:'strong'}).setJSON(`stripe-recovery-${sessionId}`,{
        caseId:result.case.id,type:'order_recovery',direction:'internal',content:note,
        createdBy:http.clean(body.operatorName,80)||'admin',createdAt:new Date().toISOString(),
      },{onlyIfNew:true});
    }
    return json({ok:true,...result,notifications:delivery?.results||payment?.notifications||{},notificationState:delivery?.status||'unknown',sentNow:false},result.created?201:200);
  }catch(error){
    console.error('product-order recovery failed',{type:error?.type||error?.name});
    if(error?.type==='StripeInvalidRequestError')return json({error:'Checkout-sessionen hittades inte på sajtens Stripe-konto.'},404);
    return json({error:'Ordern kunde inte verifieras eller sparas. Ingen kundkommunikation har skickats.'},502);
  }
};
export const config={path:'/api/product-orders'};
