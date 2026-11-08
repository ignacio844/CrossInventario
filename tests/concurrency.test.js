import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,reconcile} from '../src/domain.js';
import {fetchJson,prepareAction,isCurrentSnapshot} from '../src/transport.js';
import * as api from '../src/api.js';

function fixture(count=10){
 const data={products:[],octosis:[],wms:[],cross:[],cases:{},events:[],meta:{importId:'base'},revision:0};
 for(let index=0;index<count;index++){
  const sku='SKU-'+index,old='1A / '+index+' 1',position='1A '+index+' 01';
  data.products.push([sku,'Artículo '+index,1]);data.cross.push([position,old]);
  data.octosis.push([sku,10,old,'DISTRIMAR B']);data.wms.push([sku,9,position,'','CONT-'+index,9,'Artículo']);
 }
 return data;
}
const user={email:'operario@example.test',role:'C-Administrativo'};
const payload=row=>({id:row.id,action:'accept',reason:'Verificado',expectedRevision:0,expectedCaseVersion:row.caseVersion,requestId:crypto.randomUUID()});

test('diez usuarios pueden guardar distintos casos desde la misma versión sin invalidarse entre sí',()=>{
 let data=fixture();const pending=reconcile(data).rows.map(payload);
 for(const [index,action] of pending.entries())data=applyAction(data,action,{...user,email:'usuario'+index+'@example.test'});
 assert.equal(data.revision,10);assert.equal(data.events.length,10);
 assert.equal(new Set(data.events.map(event=>event.user)).size,10);
 assert.ok(reconcile(data).rows.every(row=>row.status==='Aceptado'));
});

test('dos decisiones sobre el mismo caso no se sobrescriben, aunque se reabra al estado anterior',()=>{
 let data=fixture(1);const initial=reconcile(data).rows[0],first=payload(initial),second=payload(initial);
 data=applyAction(data,first,user);
 assert.throws(()=>applyAction(data,second,{...user,email:'otro@example.test'}),error=>error.status===409&&error.code==='CASE_CHANGED');
 const accepted=reconcile(data).rows[0];data=applyAction(data,{...payload(accepted),action:'reopen'},user);
 assert.equal(reconcile(data).rows[0].status,initial.status);
 assert.throws(()=>applyAction(data,second,user),/Este caso cambió/);
 assert.equal(data.events.length,2);
});

test('un cambio de stock del caso bloquea la decisión vieja; un cambio en otro artículo no la bloquea',()=>{
 let data=fixture(2);const rows=reconcile(data).rows,action=payload(rows[0]);
 data={...data,revision:1,wms:data.wms.map(row=>row[0]===rows[1].sku?[row[0],8,...row.slice(2)]:row)};
 assert.equal(applyAction(data,action,user).events.length,1);
 data={...data,revision:2,wms:data.wms.map(row=>row[0]===rows[0].sku?[row[0],8,...row.slice(2)]:row)};
 assert.throws(()=>applyAction(data,action,user),error=>error.code==='CASE_CHANGED');
});

test('mensajes simultáneos se agregan sin reemplazar una decisión ni invalidar un control abierto',()=>{
 let data=fixture(1);const row=reconcile(data).rows[0],action=payload(row);
 data=applyAction(data,{...action,action:'note',message:'Primer relevamiento'},user);
 data=applyAction(data,{...action,action:'accept',requestId:'decision'},user);
 for(let index=0;index<10;index++)data=applyAction(data,{...action,action:'note',message:'Mensaje '+index,requestId:'mensaje-'+index},user);
 assert.equal(reconcile(data).rows[0].status,'Aceptado');assert.equal(data.cases[row.id].noteCount,11);
 assert.equal(data.events.length,12);assert.equal(data.cases[row.id].reason,'Verificado');
});

test('reintentos ocupados conservan exactamente el payload y notifican la espera',async()=>{
 const original=global.fetch,requests=[],delays=[],messages=[];
 try{
  global.fetch=async(url,options)=>{requests.push(options.body);return new Response(JSON.stringify(requests.length<4?{error:'Ocupado',code:'BUSY'}:{ok:true}),{status:requests.length<4?429:200});};
  const body=JSON.stringify({requestId:'same-operation',reason:'No perder este texto'});
  assert.deepEqual(await fetchJson('/api/action',{method:'POST',body},{idempotent:true,sleep:async delay=>delays.push(delay),random:()=>0,onWait:text=>messages.push(text)}),{ok:true});
  assert.deepEqual(requests,[body,body,body,body]);assert.deepEqual(delays,[500,1000,2000]);assert.equal(messages.length,3);
 }finally{global.fetch=original;}
});

test('un timeout posterior a una escritura se reintenta sin duplicar la acción',async()=>{
 const original=global.fetch;let data=fixture(1),attempts=0;
 try{
  const body=payload(reconcile(data).rows[0]);
  global.fetch=async(url,options)=>{attempts++;data=applyAction(data,JSON.parse(options.body),user);if(attempts===1)throw new Error('La respuesta se perdió');return new Response(JSON.stringify({revision:data.revision}));};
  const result=await fetchJson('/api/action',{method:'POST',body:JSON.stringify(body)},{idempotent:true,sleep:async()=>{}});
  assert.equal(result.revision,1);assert.equal(data.events.length,1);assert.equal(attempts,2);
 }finally{global.fetch=original;}
});

test('un conflicto real o una sesión inválida no se reintentan ni se convierten en éxito',async()=>{
 const original=global.fetch;let calls=0;
 try{
  for(const status of [401,409]){
   calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'Revisar',code:status===409?'CASE_CHANGED':undefined}),{status});};
   await assert.rejects(fetchJson('/api/action',{}, {idempotent:true,sleep:async()=>{}}),error=>error.status===status);
   assert.equal(calls,1);
  }
  calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify({error:'Ocupado'}),{status:429});};
  await assert.rejects(fetchJson('/api/action',{}, {idempotent:true,sleep:async()=>{}}),error=>error.status===429);
  assert.equal(calls,8);
 }finally{global.fetch=original;}
});

test('los reintentos manuales conservan el ID si el borrador es igual y los snapshots viejos se ignoran',()=>{
 const body=payload(reconcile(fixture(1)).rows[0]),first=prepareAction(null,body);
 assert.equal(prepareAction(first,{...body,expectedRevision:99}),first);
 const note=prepareAction(null,{...body,action:'note',message:'Revisar'});assert.equal(prepareAction(note,{...note,expectedRevision:99,expectedCaseVersion:'otra-decision'}),note);
 assert.notEqual(prepareAction(first,{...body,reason:'Otra decisión'}).requestId,first.requestId);
 assert.notEqual(prepareAction(first,{...body,expectedCaseVersion:'actualizado'}).requestId,first.requestId);
 assert.equal(isCurrentSnapshot({revision:3},5),false);assert.equal(isCurrentSnapshot({revision:6},5),true);
});

test('ocupación no borra la sesión ni dispara cierre de sesión; solo un 401 de la sesión vigente lo hace',async()=>{
 const originalFetch=global.fetch,originalWindow=global.window;const window=new EventTarget();let expired=0,calls=0;
 window.addEventListener('inventory-session-expired',()=>expired++);global.window=window;
 try{
  global.fetch=async(path)=>path==='/api/config'?new Response(JSON.stringify({mode:'sheets',backend:'apps-script'}),{headers:{'Content-Type':'application/json'}}):new Response(JSON.stringify(++calls===1?{error:'Ocupado'}:{revision:1}),{status:calls===1?429:200});
  await api.init();api.setToken('s1.test-session');
  await api.action({requestId:'stable',action:'note'});assert.equal(api.hasSession(),true);assert.equal(expired,0);
  global.fetch=async()=>new Response(JSON.stringify({error:'Otro usuario actualizó este caso',code:'CASE_CHANGED'}),{status:409});
  await assert.rejects(api.action({requestId:'stable'}),error=>error.code==='CASE_CHANGED');assert.equal(api.hasSession(),true);assert.equal(expired,0);
  global.fetch=async()=>{api.setToken('s1.newer-session');return new Response(JSON.stringify({error:'Sesión vieja vencida'}),{status:401});};
  await assert.rejects(api.action({requestId:'old-session'}));assert.equal(api.hasSession(),true);assert.equal(expired,0);
  global.fetch=async()=>new Response(JSON.stringify({error:'Sesión vencida'}),{status:401});
  await assert.rejects(api.action({requestId:'expired'}));assert.equal(api.hasSession(),false);assert.equal(expired,1);
 }finally{global.fetch=originalFetch;global.window=originalWindow;api.setToken('');}
});

export {fixture};
