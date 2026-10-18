const { clean } = require('./http');
const { createInternalCase, caseIdForKey } = require('./internal-case');
const shippingFor = (session) => {
  const value=session.collected_information?.shipping_details || session.shipping_details;
  if(!value)return null;
  const address=value.address||{};
  return {name:clean(value.name,140),address:Object.fromEntries(['line1','line2','city','postal_code','state','country'].map(key=>[key,clean(address[key],180)]))};
};
const orderKey = (sessionId) => `stripe:${sessionId}`;
const orderReference = (session) => clean(session.id,180).slice(-12).toUpperCase();
const orderBody = (session) => {
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session.id || '')) throw new Error('Ogiltig Checkout-referens.');
  if (session.payment_status !== 'paid') throw new Error('Stripe har inte bekräftat betalningen.');
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total <= 0 || session.currency !== 'sek') throw new Error('Endast betalda SEK-order kan importeras.');
  const shipping = session.collected_information?.shipping_details || session.shipping_details || {};
  const details = session.customer_details || {};
  const product = clean(session.metadata?.product_name,240);
  if (!product || !session.metadata?.product_id) throw new Error('Produktuppgifter saknas i Stripe.');
  return {
    customerName: details.name || shipping.name || details.email || 'Stripe-kund',
    customerEmail: details.email || session.customer_email, customerPhone: details.phone,
    vehicleModel: product, source:'stripe-checkout', operatorName:'Stripe (verifierad)',
    caseType:'product_order', service:`Beställning av ${product}`, totalCost:session.amount_total/100,
    message:`Produktorder ${orderReference(session)}. Leveransval och leverantörsbeställning behöver följas upp.`,
  };
};
const ensureProductOrder = async ({session,store,indexStore,dryRun=false}) => {
  const body=orderBody(session);
  // Build full record before the atomic create; do not patch it after creation.
  // createInternalCase accepts only trusted enrichment, supplied server-side here.
  return createInternalCase({store,indexStore,body,key:orderKey(session.id),dryRun,
    enrich: (item) => ({...item,
      order:{provider:'stripe',sessionId:session.id,reference:orderReference(session),productId:clean(session.metadata.product_id,180),brand:clean(session.metadata.brand,120),shipping:shippingFor(session)},
      payment:{...item.payment,status:'paid',method:session.payment_method_types?.length===1 && session.payment_method_types[0]==='klarna'?'other':'card',provider:'stripe',providerMethod:session.payment_method_types?.join(',') || '',reference:clean(typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id,180),paidAt:null,verifiedAt:item.createdAt,verifiedBy:'stripe',amount:session.amount_total/100},
      notifications:{thankYou:{status:'suppressed',reason:'product_order_not_fulfilled'}},
      timeline:[...item.timeline,{at:item.createdAt,event:`Produktköp verifierat via Stripe: ${session.amount_total/100} kr. Leverans ej bekräftad.`}],
    })});
};
module.exports={ensureProductOrder,orderBody,orderReference,orderKey,orderCaseId:(id)=>caseIdForKey(orderKey(id))};
