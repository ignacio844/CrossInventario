import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {demoData} from '../src/demo.js';
import {applyAction,reconcile,isResolved} from '../src/domain.js';

function action(data,extra={}) {
  const row=reconcile(data).rows.find(row=>row.sku==='DEMO-LAMP-H7'&&row.active);
  return {id:row.id,action:'accept',reason:'Control realizado; diferencia aceptada.',expectedRevision:data.revision,requestId:'accept-request',...extra};
}
test('todos los roles autenticados pueden aceptar diferencias y el historial identifica al responsable',()=>{
  for(const role of ['C-Administrativo','C1','C2','C3']){
    const data=demoData(),user={email:'operario@example.test',role},next=applyAction(data,action(data),user,'2026-11-07T15:00:00Z');
    const row=reconcile(next).rows.find(row=>row.review.status==='Aceptado');
    assert.equal(row.status,'Aceptado');assert.equal(isResolved(row),true);assert.equal(row.delta,-10);
    assert.equal(next.events[0].user,user.email);assert.equal(next.events[0].role,role);
    assert.equal(next.events[0].after.reason,'Control realizado; diferencia aceptada.');
    assert.deepEqual(next.wms,data.wms);assert.deepEqual(next.octosis,data.octosis);
  }
});
test('aceptar conserva la sesión obligatoria, el motivo para diferencias y el control de concurrencia',()=>{
  const data=demoData(),user={email:'admin@example.test',role:'C-Administrativo'};
  assert.throws(()=>applyAction(data,action(data),null),/sesión/);
  assert.throws(()=>applyAction(data,action(data,{reason:' '}),user),/motivo/);
  assert.throws(()=>applyAction(data,action(data,{expectedRevision:-1}),user),/Otro usuario/);
  const next=applyAction(data,action(data),user);
  assert.equal(applyAction(next,action(data),user),next);
});
test('aceptaciones históricas C3 siguen resueltas y conservan su estado y huella',()=>{
  const data=demoData(),row=reconcile(data).rows.find(row=>row.id===action(data).id);
  data.cases[row.id]={status:'Aceptado C3',fingerprint:row.fingerprint,updatedBy:'supervisor@example.test'};
  const historical=reconcile(data).rows.find(value=>value.id===row.id);
  assert.equal(historical.status,'Aceptado C3');assert.equal(isResolved(historical),true);
  assert.equal(data.cases[row.id].updatedBy,'supervisor@example.test');
});
test('el Apps Script generado permite aceptar a un administrativo y mantiene restringidos los ajustes',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
  context.fixture=demoData();context.payload=action(context.fixture);context.user={email:'admin@example.test',role:'C-Administrativo'};
  const result=vm.runInContext('applyAction(fixture,payload,user)',context);
  assert.equal(result.cases[context.payload.id].status,'Aceptado');
  assert.equal(result.events[0].role,'C-Administrativo');
  for(const name of ['adjust','verify','reopen']){
    context.payload={...action(context.fixture),action:name,quantity:120};
    assert.throws(()=>vm.runInContext('applyAction(fixture,payload,user)',context),/C3/);
  }
});
