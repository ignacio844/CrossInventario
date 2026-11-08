import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fetchJson} from '../src/transport.js';

function setup(){
 const values=new Map();let reads=0,revision=7;
 const cache={get:key=>values.get(key)||null,put:(key,value)=>values.set(key,value),getAll:keys=>Object.fromEntries(keys.filter(key=>values.has(key)).map(key=>[key,values.get(key)])),putAll:entries=>Object.entries(entries).forEach(([key,value])=>values.set(key,value)),remove:key=>values.delete(key)};
 const context=vm.createContext({CacheService:{getScriptCache:()=>cache},Sheets:{Spreadsheets:{Values:{get:()=>{reads++;return {values:[['v2',revision]]};}},get:()=>{reads++;return {sheets:[]};}}}});
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 context.pack_=value=>({packed:Buffer.from(JSON.stringify(value)).toString('base64')});
 context.unpack_=value=>JSON.parse(Buffer.from(value.packed,'base64').toString());
 context.sourceStamp_=meta=>meta.importId;
 context.review={cases:{case:{status:'Aceptado'}},events:[{id:'saved'}],meta:{importId:'stock'},revision:7,controlV2:true};
 context.sources={cross:[],octosis:[],products:[],wms:[]};
 vm.runInContext("cacheReview_(review,true);cacheSources_('sources-v1:stock',sources)",context);cache.put('revision','7');
 return {context,values,cache,get reads(){return reads;},setRevision:value=>{revision=value;}};
}

test('diez lectores comparten el resultado guardado sin consultas adicionales a Sheets',()=>{
 const s=setup();
 for(let index=0;index<10;index++)assert.equal(vm.runInContext('loadSnapshot_().revision',s.context),7);
 assert.equal(s.reads,0);
});

test('el caché de escritura verifica la revisión real y nunca usa un caso viejo para sobrescribir',()=>{
 const s=setup();assert.equal(vm.runInContext('actionReview_().revision',s.context),7);assert.equal(s.reads,1);
 s.setRevision(8);s.context.loadReview_=()=>({revision:8,cases:{case:{status:'Solicitado C2'}}});
 assert.equal(vm.runInContext('actionReview_().cases.case.status',s.context),'Solicitado C2');assert.equal(s.reads,2);
});

test('la metadata de pestañas se consulta una sola vez y se comparte',()=>{
 const s=setup();for(let index=0;index<10;index++)vm.runInContext('sheetInfo_()',s.context);
 assert.equal(s.reads,1);
});

test('la cuota genera espera compartida y corta nuevas lecturas, pero conserva la vista disponible',()=>{
 const s=setup();s.context.failure=new Error("Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute per user'");
 const response=vm.runInContext('errorResponse_(failure)',s.context);
 assert.equal(response.status,429);assert.equal(response.code,'SHEETS_QUOTA');assert.equal(response.retryAfterMs,65000);
 for(let index=0;index<10;index++)assert.throws(()=>vm.runInContext('revision_(true)',s.context),error=>error.code==='SHEETS_QUOTA');
 assert.equal(s.reads,0);assert.equal(vm.runInContext('loadSnapshot_().revision',s.context),7);
});

test('el cliente respeta la pausa de cuota y reenvía el mismo identificador de guardado',async()=>{
 const original=global.fetch,delays=[],bodies=[],messages=[];
 try{
  global.fetch=async(url,options)=>{bodies.push(options.body);return bodies.length===1?new Response(JSON.stringify({code:'SHEETS_QUOTA',retryAfterMs:65000,error:'Límite temporal'}),{status:429}):new Response(JSON.stringify({ok:true}));};
  const result=await fetchJson('/api/action',{method:'POST',body:'{"requestId":"same"}'},{idempotent:true,sleep:async delay=>delays.push(delay),onWait:message=>messages.push(message)});
  assert.equal(result.ok,true);assert.deepEqual(delays,[65000]);assert.equal(bodies[0],bodies[1]);assert.match(messages[0],/65 segundos/);
 }finally{global.fetch=original;}
});
