#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseJsonl } from "../nemob-os/lib/repair-knowledge.mjs";

const inputPath = process.argv[2];
const outputPath = process.argv[3] || (inputPath ? path.join(path.dirname(inputPath), "review.html") : "review.html");
if (!inputPath || ["-h", "--help"].includes(inputPath)) {
  console.log("Usage: node scripts/build-repair-knowledge-review.mjs <repair_knowledge_seed.jsonl> [review.html]");
  process.exit(inputPath ? 0 : 1);
}

const raw = await readFile(inputPath, "utf8");
const parsed = parseJsonl(raw);
if (parsed.errors.length) throw new Error(`Ogiltig JSONL på rad ${parsed.errors[0].line}.`);
const safeJson = JSON.stringify(parsed.records).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>NEMOB OS — granska verkstadskunskap</title>
<style>
:root{color-scheme:dark;--bg:#0d1210;--card:#151d18;--line:#2a3830;--text:#e8efe9;--muted:#93a49a;--green:#47d178;--red:#ff8b7c;--amber:#e7c76f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}header{position:sticky;top:0;z-index:5;background:#0d1210f2;border-bottom:1px solid var(--line);padding:12px 18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}h1{font-size:18px;margin:0}h1 span{color:var(--green)}button,input,select,textarea{font:inherit}button{background:#24322a;color:var(--text);border:1px solid #3a4b41;border-radius:7px;padding:8px 11px;cursor:pointer}.primary{background:#1f5c37;border-color:#2f7a4c}.danger{background:#5c2924;border-color:#81443b}.muted{color:var(--muted)}.stats{margin-left:auto}.filters{padding:12px 18px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line)}.filters input,.filters select{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:7px;padding:9px}.list{max-width:1150px;margin:auto;padding:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:15px;margin-bottom:12px}.card.approved{border-color:#2f7a4c}.card.rejected{opacity:.55;border-color:#81443b}.head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.title{font-weight:700;font-size:16px}.chip{font-size:12px;border:1px solid var(--line);border-radius:99px;padding:2px 7px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.field{display:flex;flex-direction:column;gap:4px}.field.full{grid-column:1/-1}.field input,.field select,.field textarea{width:100%;background:#0d1210;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px}.excerpt{white-space:pre-wrap;background:#0d1210;border:1px solid var(--line);padding:10px;border-radius:7px;max-height:240px;overflow:auto}.actions{display:flex;gap:8px;margin-top:10px}.warning{color:var(--amber)}@media(max-width:720px){.grid{grid-template-columns:1fr}.stats{margin-left:0}.field.full{grid-column:auto}}
</style></head><body>
<header><h1>NEMOB <span>Repair Review</span></h1><button id="approve-visible" class="primary">Godkänn synliga</button><button id="download-approved" class="primary">Ladda ner godkända JSONL</button><button id="download-all">Ladda ner granskningsfil</button><span class="stats" id="stats"></span></header>
<div class="filters"><input id="search" type="search" placeholder="Sök modell, felkod, symptom…"><select id="filter-status"><option value="">Alla statusar</option><option>needs_review</option><option>approved</option><option>rejected</option></select><select id="filter-confidence"><option value="">All säkerhet</option><option>high</option><option>medium</option><option>low</option></select><select id="filter-brand"><option value="">Alla märken</option></select></div>
<main class="list" id="list"></main>
<script>
const records=${safeJson};
const key='nemob-repair-review-v1';
try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(Array.isArray(saved)){const byId=new Map(saved.map(r=>[r.id,r]));records.forEach((r,i)=>{if(byId.has(r.id))records[i]={...r,...byId.get(r.id)}})}}catch{}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const arr=v=>Array.isArray(v)?v.join(', '):String(v??'');
const parseList=v=>[...new Set(String(v||'').split(',').map(x=>x.trim()).filter(Boolean))];
const persist=()=>localStorage.setItem(key,JSON.stringify(records));
const state=()=>({q:document.querySelector('#search').value.toLowerCase(),status:document.querySelector('#filter-status').value,confidence:document.querySelector('#filter-confidence').value,brand:document.querySelector('#filter-brand').value});
const visible=r=>{const f=state();const hay=[r.sourceTitle,r.brand,r.model,arr(r.errorCodes),arr(r.symptoms),r.excerpt].join(' ').toLowerCase();return(!f.q||hay.includes(f.q))&&(!f.status||r.reviewStatus===f.status)&&(!f.confidence||r.confidence===f.confidence)&&(!f.brand||r.brand===f.brand)};
function updateStats(){const c={needs_review:0,approved:0,rejected:0};records.forEach(r=>c[r.reviewStatus]=(c[r.reviewStatus]||0)+1);document.querySelector('#stats').textContent='Totalt '+records.length+' · Godkända '+c.approved+' · Kvar '+c.needs_review+' · Avvisade '+c.rejected}
function card(r){return '<article class="card '+esc(r.reviewStatus)+'" data-id="'+esc(r.id)+'"><div class="head"><span class="title">'+esc(r.sourceTitle||'Utan titel')+'</span><span class="chip">'+esc(r.status)+'</span><span class="chip">'+esc(r.confidence)+'</span><span class="chip">'+esc(r.id)+'</span></div><div class="grid">'+
field('brand','Märke',r.brand)+field('model','Modell',r.model)+field('errorCodes','Felkoder',arr(r.errorCodes))+
selectField('likelyRootCause','Trolig orsak',r.likelyRootCause,['battery_cell','bms','controller','wiring','hall_sensor','motor','puncture','brake','wear','water_damage','user_error','unknown'])+
selectField('status','Kunskapsstatus',r.status,['confirmed_fix','likely_cause','disproven','diagnostic_step','parts_candidate','unknown'])+
selectField('confidence','Säkerhet',r.confidence,['high','medium','low'])+
textArea('symptoms','Symptom, kommaseparerat',arr(r.symptoms))+textArea('testsPerformed','Tester, kommaseparerat',arr(r.testsPerformed))+textArea('partsMentioned','Delar, kommaseparerat',arr(r.partsMentioned))+
textArea('resolution','Bekräftad lösning',r.resolution||'')+textArea('diagnosticLesson','Lärdom',r.diagnosticLesson||'')+
'<div class="field full"><span>Rensat utdrag</span><div class="excerpt">'+esc(r.excerpt)+'</div>'+(r.redactionWarnings?.length?'<div class="warning">Integritetsvarning: '+esc(r.redactionWarnings.join(', '))+'</div>':'')+'</div></div><div class="actions"><button class="primary" data-action="approved">Godkänn</button><button class="danger" data-action="rejected">Avvisa</button><button data-action="needs_review">Återställ</button></div></article>'}
function field(name,label,value){return '<label class="field"><span>'+esc(label)+'</span><input data-field="'+name+'" value="'+esc(value)+'"></label>'}
function textArea(name,label,value){return '<label class="field full"><span>'+esc(label)+'</span><textarea rows="2" data-field="'+name+'">'+esc(value)+'</textarea></label>'}
function selectField(name,label,value,options){return '<label class="field"><span>'+esc(label)+'</span><select data-field="'+name+'">'+options.map(o=>'<option '+(o===value?'selected':'')+'>'+esc(o)+'</option>').join('')+'</select></label>'}
function render(){document.querySelector('#list').innerHTML=records.filter(visible).map(card).join('')||'<p class="muted">Inga träffar.</p>';updateStats()}
const listFields=new Set(['errorCodes','symptoms','testsPerformed','partsMentioned']);
document.body.addEventListener('change',e=>{const field=e.target.dataset.field;if(!field)return;const card=e.target.closest('[data-id]');const r=records.find(x=>x.id===card.dataset.id);r[field]=listFields.has(field)?parseList(e.target.value):e.target.value||null;persist();updateStats()});
document.body.addEventListener('click',e=>{const action=e.target.dataset.action;if(!action)return;const card=e.target.closest('[data-id]');const r=records.find(x=>x.id===card.dataset.id);r.reviewStatus=action;r.reviewedAt=new Date().toISOString();r.reviewedBy='Sebastian';persist();render()});
['search','filter-status','filter-confidence','filter-brand'].forEach(id=>document.querySelector('#'+id).addEventListener(id==='search'?'input':'change',render));
const brands=[...new Set(records.map(r=>r.brand).filter(Boolean))].sort();document.querySelector('#filter-brand').insertAdjacentHTML('beforeend',brands.map(b=>'<option>'+esc(b)+'</option>').join(''));
document.querySelector('#approve-visible').onclick=()=>{records.filter(visible).forEach(r=>{r.reviewStatus='approved';r.reviewedAt=new Date().toISOString();r.reviewedBy='Sebastian'});persist();render()};
function download(filename,items){const blob=new Blob([items.map(r=>JSON.stringify(r)).join('\n')+(items.length?'\n':'')],{type:'application/x-ndjson'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
document.querySelector('#download-approved').onclick=()=>download('approved_repair_knowledge.jsonl',records.filter(r=>r.reviewStatus==='approved'));
document.querySelector('#download-all').onclick=()=>download('reviewed_repair_knowledge.jsonl',records);
render();
</script></body></html>`;

await writeFile(outputPath, html, "utf8");
console.log(`Skapade lokal granskningssida: ${outputPath}`);
console.log("Öppna filen i webbläsaren. Ingen data skickas över internet.");
