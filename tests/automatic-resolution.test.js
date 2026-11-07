import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,isResolved,applyAction} from '../src/domain.js';

const fixture=()=>({octosis:[['SKU',5,'OLD','DISTRIMAR B']],products:[['SKU','Producto',1]],cross:[['A 001 01','OLD']],wms:[['SKU',5,'A 001 01','','',5,'Producto']],cases:{},events:[],meta:{},revision:0});
test('cantidad y ubicación coincidentes se resuelven sin usuario ni aprobación C3',()=>{
  const data=fixture(),row=reconcile(data).rows[0];
  assert.equal(row.status,'Resuelto automáticamente');assert.equal(isResolved(row),true);
  assert.deepEqual(data.cases,{});assert.equal(data.events.length,0);
  assert.equal(reconcile(data).rows[0].status,row.status);
});
test('DISTRIMAR N se suma a la referencia de Octosis sin duplicar otros depósitos',()=>{
  const data=fixture();
  data.octosis.push(['SKU',3,'OLD','DISTRIMAR N'],['SKU',100,'OLD','DISTRIMAR REV']);
  data.wms[0][1]=8;
  const row=reconcile(data).rows[0];
  assert.equal(row.oldQty,8);assert.equal(row.oldDetails.length,2);
  assert.equal(row.status,'Resuelto automáticamente');
});
test('cantidad distinta, ausencia de stock y cross irregular no se resuelven automáticamente',()=>{
  for(const mutate of [d=>d.wms[0][1]=4,d=>d.wms=[],d=>d.cross=[],d=>{d.octosis[0][1]=0;d.wms=[];}]){
    const data=fixture();mutate(data);
    assert.ok(reconcile(data).rows.every(row=>!row.autoResolved&&!isResolved(row)));
  }
});
test('una diferencia posterior vuelve a pendientes y las coincidencias conservan el historial anterior',()=>{
  let data=fixture();data.wms[0][1]=4;
  const id=reconcile(data).rows[0].id;
  data=applyAction(data,{id,action:'request-c2',reason:'Recontar',expectedRevision:0},{email:'admin@example.test',role:'C-Administrativo'});
  data.wms[0][1]=5;
  assert.equal(reconcile(data).rows[0].status,'Resuelto automáticamente');
  assert.equal(data.events.length,1);assert.equal(data.cases[id].status,'Solicitado C2');
  data.wms[0][1]=3;
  const changed=reconcile(data).rows[0];
  assert.equal(changed.status,'Revisar cambio');assert.equal(isResolved(changed),false);
});
