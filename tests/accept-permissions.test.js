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
test('el Apps Script generado habilita todo el seguimiento para todos los roles autenticados',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
  for(const role of ['C1','C2','C-Administrativo','C3']){
    context.fixture=demoData();context.user={email:'operario@example.test',role};
    function save(name,extra={}){
      context.payload={...action(context.fixture),action:name,requestId:name,...extra};
      context.fixture=vm.runInContext('applyAction(fixture,payload,user)',context);
      return context.fixture.cases[context.payload.id];
    }
    assert.equal(save('request-c2').status,'Solicitado C2');
    assert.equal(save('record-c2',{quantity:115}).status,'C2 registrado');
    assert.equal(save('accept').status,'Aceptado');
    assert.equal(save('adjust',{quantity:110}).status,'Ajustado en WMS');
    assert.throws(()=>save('verify'),/posterior/);
    context.fixture.meta={...context.fixture.meta,importId:'posterior'};
    assert.equal(save('verify').status,'Verificado');
    assert.equal(save('reopen').status,'Pendiente');
    assert.equal(context.fixture.events.length,6);
    assert.ok(context.fixture.events.every(event=>event.role===role));
  }
});
