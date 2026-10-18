const { createHash, randomUUID } = require('node:crypto');
const { clean } = require('./http');

const caseIdForKey = (key) => `case_internal_${createHash('sha256').update(key).digest('hex').slice(0,32)}`;
const buildInternalCase = (body, { id, now = new Date().toISOString(), serviceNumber = '' } = {}) => {
  const name = clean(body.customerName || body.name, 140);
  const email = clean(body.customerEmail || body.email, 180);
  const phone = clean(body.customerPhone || body.phone, 80);
  if (!name) throw new Error('Kundnamn krävs.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ogiltig e-postadress.');
  const operator = clean(body.operatorName, 80) || 'admin';
  const totalCost = Number(body.totalCost || 0);
  if (!Number.isFinite(totalCost) || totalCost < 0) throw new Error('Belopp måste vara noll eller större.');
  const type = body.caseType === 'product_order' ? 'product_order' : 'service';
  return {
    id: id || `case_${randomUUID()}`, serviceNumber, createdAt: now, updatedAt: now,
    createdBy: { name: operator, source: 'admin' }, updatedBy: { name: operator, source: 'admin', at: now },
    status: 'contacted', source: clean(body.source,80) || 'admin', channel: 'internal',
    caseType: type, priority: 'normal', preferredDate: null, preferredContactTime: null,
    contactMethod: email ? 'email' : phone ? 'sms' : 'phone', logistics: 'unknown',
    assignedTo: { key: 'sebastian', name: 'Sebastian', role: 'Ägare/admin' },
    customer: { name, phone, email }, vehicle: { model: clean(body.vehicleModel,180) },
    service: clean(body.service,160) || (type === 'product_order' ? 'Produktbeställning' : 'Kundärende'),
    message: clean(body.message,3000), addons: [], estimatedValue: totalCost, intakeAt: null, promisedAt: null,
    notes: body.note ? [{ at: now, text: clean(body.note,2000) }] : [],
    notifications: {}, confirmation_sent: false, confirmation_missing: false,
    completion: { totalCost, workSummary: clean(body.workSummary,3000), priceRows: [], updatedAt: now },
    payment: { status: 'unpaid', amount: totalCost, method: '', reference: '', updatedAt: now },
    timeline: [{ at: now, event: `Internt ärende skapat av ${operator}. Inga kundutskick.` }],
  };
};
// Only immutable create-if-absent writes: a retry must never overwrite a case
// that staff have since edited. Reads fail closed; storage errors are not 404s.
const createInternalCase = async ({ store, indexStore, body, key, dryRun = false, enrich = (item) => item }) => {
  const id = key ? caseIdForKey(key) : `case_${randomUUID()}`;
  const existing = key ? await store.get(id, { type: 'json' }) : null;
  if (existing) return { case: existing, created: false };
  const digest = createHash('sha256').update(id).digest('hex').slice(0,12).toUpperCase();
  const serviceNumber = `NEM-${digest.slice(0,4)}-${digest.slice(4,8)}-${digest.slice(8)}`;
  const item = enrich(buildInternalCase(body, { id, serviceNumber }));
  if (dryRun) return { case: item, created: false, dryRun: true };
  const reservation = await indexStore.setJSON(serviceNumber, {caseId:id, serviceNumber}, {onlyIfNew:true});
  if (!reservation.modified) {
    const owner = await indexStore.get(serviceNumber,{type:'json'});
    if (owner?.caseId !== id) throw new Error('Servicenummer upptaget. Försök med en ny registrering.');
  }
  const saved = await store.setJSON(id,item,{onlyIfNew:true});
  if (saved.modified) return {case:item,created:true};
  const winner = await store.get(id,{type:'json'});
  if (!winner) throw new Error('Ärendet kunde inte bekräftas. Försök igen med samma referens.');
  return {case:winner,created:false};
};
module.exports = { buildInternalCase, createInternalCase, caseIdForKey };
