import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {demoData} from '../src/demo.js';
import {applyAction,reconcile,isResolved} from '../src/domain.js';
import {tableRow,matchesReviewFilter,columnMatches,sortRows} from '../src/table.js';

const user={email:'administrativo@example.test',role:'C-Administrativo'};
const now='2026-11-08T11:00:00Z';
const lamp=data=>reconcile(data).rows.find(row=>row.sku==='DEMO-LAMP-H7'&&row.active);
function save(data,action,extra={}) {
  return applyAction(data,{id:lamp(data).id,action,reason:'Control físico realizado',expectedRevision:data.revision,requestId:crypto.randomUUID(),...extra},user,now);
}

test('aceptar salda la diferencia operativa y conserva el stock y el delta original',()=>{
  const data=save(demoData(),'accept'),row=tableRow(lamp(data));
  assert.equal(row.oldQty,120);assert.equal(row.wmsQty,110);assert.equal(row.delta,-10);
  assert.equal(row.pendingDelta,0);assert.equal(row.observation,'Diferencia aceptada');
  assert.equal(row.needsAnalysis,false);assert.equal(row.acceptedDifference,true);
  assert.equal(matchesReviewFilter(row,'different'),false);assert.equal(matchesReviewFilter(row,'accepted'),true);
  assert.equal(columnMatches(row,{pendingDelta:'=0',delta:'<0',observation:'aceptada'}),true);
  const pending=tableRow(lamp(demoData()));
  assert.equal(pending.pendingDelta,-10);assert.equal(matchesReviewFilter(pending,'analysis'),true);
  assert.deepEqual(sortRows([row,pending],{key:'pendingDelta',direction:'asc'}).map(row=>row.pendingDelta),[-10,0]);
});

test('estados históricos y verificaciones se ven saldados; las coincidencias se resuelven solas',()=>{
  for(const status of ['Aceptado C3','Verificado C3','Verificado']){
    const data=demoData(),row=lamp(data);
    data.cases[row.id]={status,fingerprint:row.fingerprint};
    assert.equal(tableRow(lamp(data)).pendingDelta,0);
    assert.equal(isResolved(lamp(data)),true);
  }
  const match=tableRow(reconcile(demoData()).rows.find(row=>row.sku==='DEMO-ESCO-01'));
  assert.equal(match.observation,'Sin diferencias');assert.equal(match.needsAnalysis,false);
});

test('una ubicación irregular con cantidad igual requiere análisis hasta ser aceptada',()=>{
  const row={...lamp(demoData()),kind:'Coincide',delta:0,reviewedDelta:0,locationMatches:false,status:'Pendiente'};
  const pending=tableRow(row);
  assert.equal(pending.needsAnalysis,true);assert.equal(pending.observation,'Ubicación distinta');
  assert.equal(matchesReviewFilter(pending,'mapping'),true);
  const accepted=tableRow({...row,status:'Aceptado'});
  assert.equal(accepted.observation,'Observación aceptada');assert.equal(accepted.needsAnalysis,false);
});

test('el mensaje es opcional, exige sesión y respeta concurrencia, longitud e idempotencia',()=>{
  const data=demoData(),payload={id:lamp(data).id,action:'note',message:' ',expectedRevision:0,requestId:'note-one'};
  assert.equal(applyAction(data,payload,user),data);
  assert.throws(()=>applyAction(data,payload,null),/sesión/);
  assert.throws(()=>applyAction(data,{...payload,message:'a'.repeat(2001)},user),/2.000/);
  assert.throws(()=>applyAction(data,{...payload,message:'Revisar',expectedRevision:-1},user),/Otro usuario/);
  const next=applyAction(data,{...payload,message:' Revisar el contenedor EJ-001 '},user,now);
  assert.equal(next.revision,1);assert.equal(next.cases[payload.id].note.text,'Revisar el contenedor EJ-001');
  assert.equal(next.events[0].note.by,user.email);assert.equal(next.events[0].role,user.role);assert.equal(next.events[0].at,now);
  assert.equal(applyAction(next,{...payload,message:'Revisar'},user),next);
  assert.equal(next.octosis,data.octosis);assert.equal(next.wms,data.wms);assert.equal(next.meta,data.meta);
});

test('un mensaje en un caso sin decisión no crea Revisar cambio y sigue siendo pendiente',()=>{
  const next=save(demoData(),'note',{message:'Recontar antes de ajustar'}),row=lamp(next);
  assert.equal(row.changed,false);assert.equal(row.status,'Pendiente');assert.equal(row.review.fingerprint,undefined);
  assert.equal(matchesReviewFilter(tableRow(row),'notes'),true);
  assert.equal(tableRow(row).pendingDelta,-10);
});

test('mensajes sobre un caso aceptado preservan decisión, autor, motivo y huella',()=>{
  const accepted=save(demoData(),'accept'),before=lamp(accepted);
  const next=save(accepted,'note',{message:'Diferencia relevada; verificar remanente'}),after=lamp(next);
  assert.equal(after.status,'Aceptado');assert.equal(after.changed,false);
  for(const key of ['reason','updatedBy','updatedAt','fingerprint'])assert.equal(after.review[key],before.review[key]);
  assert.equal(tableRow(after).pendingDelta,0);
  assert.equal(matchesReviewFilter(tableRow(after),'notes'),true);
});

test('mensajes no esconden cambios de stock posteriores a una aceptación',()=>{
  const accepted=save(demoData(),'accept');
  const changed={...accepted,wms:accepted.wms.map(row=>row[0]==='DEMO-LAMP-H7'?[row[0],109,...row.slice(2)]:row)};
  const previous=lamp(changed).review.fingerprint;
  const after=lamp(save(changed,'note',{message:'Revisar la corrección de WMS'}));
  assert.equal(after.status,'Aceptado');assert.equal(after.changed,true);assert.equal(after.closurePreserved,true);
  assert.equal(after.review.fingerprint,previous);assert.equal(tableRow(after).pendingDelta,0);assert.equal(tableRow(after).reviewedDelta,-10);assert.equal(after.postReviewDelta,-1);
});

test('se pueden dejar mensajes sin carga WMS, sin habilitar ni cerrar su revisión',()=>{
  const data=demoData(),row=reconcile(data).rows.find(row=>!row.active);
  const next=applyAction(data,{id:row.id,action:'note',message:'Pendiente de carga',expectedRevision:0,requestId:'inactive-note'},user,now);
  const after=reconcile(next).rows.find(value=>value.id===row.id);
  assert.equal(after.status,'Sin carga WMS');assert.equal(after.active,false);
});

test('el último mensaje se muestra en la tabla y los anteriores permanecen en el historial',()=>{
  let data=save(demoData(),'note',{message:'Primer relevamiento'});
  data=save(data,'note',{message:'Segundo relevamiento'});
  data=save(data,'request-c2');
  const row=lamp(data);
  assert.equal(row.review.note.text,'Segundo relevamiento');assert.equal(row.review.noteCount,2);
  assert.deepEqual(data.events.filter(event=>event.action==='note').map(event=>event.note.text),['Primer relevamiento','Segundo relevamiento']);
  assert.equal(row.status,'Solicitado C2');
});

test('Apps Script soporta mensajes sin modificar el estado y valida todas las fuentes para todos los roles',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
  context.data=demoData();context.user=user;
  context.payload={id:lamp(context.data).id,action:'note',message:'Controlar ubicación',expectedRevision:0,requestId:'gas-note'};
  const result=vm.runInContext('applyAction(data,payload,user)',context);
  assert.equal(result.cases[context.payload.id].note.text,'Controlar ubicación');assert.equal(result.cases[context.payload.id].status,undefined);
  for(const role of ['C1','C2','C-Administrativo','C3']){
    context.user={email:'operario@example.test',role};
    for(const [type,rows] of Object.entries({cross:[['A','B']],products:[['SKU','Artículo',1,'001']],octosis:[['SKU',5,'B','DISTRIMAR B']],wms:[['SKU',5,'A','','',5,'Artículo']]})){
      context.type=type;context.rows=rows;
      assert.equal(vm.runInContext('validate_(type,rows,user).length',context),1);
    }
  }
});
