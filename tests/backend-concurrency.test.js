import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {demoData} from '../src/demo.js';
import {reconcile} from '../src/domain.js';

function setup(){
 let held=false,acquisitions=0,allow=true;const batches=[];
 const context=vm.createContext({CacheService:{getScriptCache:()=>({put(){}})},Sheets:{Spreadsheets:{get:()=>({sheets:['Octosis','Productos','Cross','WMS','Casos','Historial','Control'].map((title,sheetId)=>({properties:{title,sheetId,gridProperties:{rowCount:1000,columnCount:10}}}))}),batchUpdate:({requests})=>{assert.equal(held,true);batches.push(requests);}}},LockService:{getScriptLock:()=>({tryLock:milliseconds=>{assert.equal(milliseconds,2000);acquisitions++;held=allow;return allow;},releaseLock:()=>{held=false;},hasLock:()=>held})}});
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 context.data={...demoData(),controlV2:true};context.packs=0;
 context.user_=()=>({email:'operario@example.test',role:'C-Administrativo'});
 context.revision_=()=>context.data.revision;context.cacheReview_=()=>{};context.readControl_=()=>({meta:context.data.meta,revision:context.data.revision});
 context.sourceStamp_=meta=>meta.importId;
 context.loadSources_=()=>{assert.equal(held,false);return Object.fromEntries(['octosis','products','cross','wms'].map(key=>[key,context.data[key]]));};
 context.loadReview_=()=>{assert.equal(held,true);return context.data;};
 context.pack_=value=>{assert.equal(held,false);context.packs++;return value;};context.json_=value=>value;
 const call=body=>{context.input={op:'action',token:'s1.test',body};return vm.runInContext('doPost({postData:{contents:JSON.stringify(input)}})',context);};
 return {context,batches,call,setBusy:()=>{allow=false;},get acquisitions(){return acquisitions;},get held(){return held;}};
}

test('Apps Script precarga fuentes sin bloqueo y libera el bloqueo antes de preparar la respuesta',()=>{
 const s=setup(),row=reconcile(s.context.data).rows.find(row=>row.active&&row.delta!==0);
 const result=s.call({id:row.id,action:'accept',reason:'Controlado',expectedRevision:0,expectedCaseVersion:row.caseVersion,requestId:'one'});
 assert.equal(result.rawState.revision,1);assert.equal(s.held,false);assert.equal(s.context.packs,1);
 const updates=s.batches.flat().filter(request=>request.updateCells).map(request=>request.updateCells);
 assert.equal(updates.filter(update=>update.start?.sheetId===4).length,1);
 assert.equal(updates.find(update=>update.start?.sheetId===4).rows.length,1);
 assert.equal(updates.find(update=>update.start?.sheetId===6).start.columnIndex,1);
 assert.equal(s.batches.flat().filter(request=>request.appendCells).length,1);
 assert.ok(updates.every(update=>[4,6].includes(update.start?.sheetId)));
});

test('ocupación devuelve 429 sin invalidar la sesión y las lecturas no esperan el bloqueo de escritura',()=>{
 const s=setup();s.setBusy();
 const result=s.call({id:'x',action:'accept',requestId:'retry'});
 assert.equal(result.status,429);assert.equal(result.code,'BUSY');assert.equal(s.batches.length,0);
 s.context.loadSnapshot_=()=>s.context.data;s.context.syncPublic_=()=>({});s.context.loadHistory_=()=>({events:[]});
 for(const op of ['state','history']){
  s.context.input={op,token:'s1.test'};const response=vm.runInContext('doPost({postData:{contents:JSON.stringify(input)}})',s.context);
  assert.equal(response.status,undefined);
 }
 assert.equal(s.acquisitions,1);
});

test('un conflicto del mismo caso libera el bloqueo y no escribe nada',()=>{
 const s=setup(),row=reconcile(s.context.data).rows.find(row=>row.active&&row.delta!==0);
 const result=s.call({id:row.id,action:'accept',reason:'Controlado',expectedRevision:0,expectedCaseVersion:'stale',requestId:'two'});
 assert.equal(result.status,409);assert.equal(result.code,'CASE_CHANGED');assert.equal(s.batches.length,0);assert.equal(s.held,false);
});
