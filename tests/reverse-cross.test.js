import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,octPositionKey,applyAction,C3_EMAILS} from '../src/domain.js';
import {tableRow} from '../src/table.js';

const fixture=()=>({octosis:[],products:[['SKU','Producto',1]],cross:[],wms:[],cases:{},events:[],meta:{},revision:0});
const stock=(quantity,position)=>['SKU',quantity,position,'','',quantity,'Producto'];

test('cruce inverso conserva el texto del mismo cross y no atribuye stock de otra posición',()=>{
  const data=fixture();
  data.octosis=[['SKU',22,'2A / 3 5','DISTRIMAR B']];
  data.cross=[['2A 005 01','2A / 5 5']];
  data.wms=[stock(22,'2A 005 01')];
  const row=reconcile(data).rows.find(row=>row.wmsPresent);
  assert.deepEqual(tableRow(row).originalLocations,['2A / 5 5']);
  assert.equal(row.oldPresent,false);assert.equal(row.oldQty,0);assert.equal(row.wmsQty,22);
  assert.equal(row.locationMatches,true);assert.equal(row.kind,'Solo WMS');
  assert.equal(row.autoResolved,false);assert.equal(row.status,'Pendiente');
});
test('el inverso incluye solo relaciones directas de ubicaciones cargadas, no todas las del grupo',()=>{
  const data=fixture();
  data.cross=[['A 001 01','2B / 1 1'],['A 002 01','2B / 1 1'],['A 002 01','2C / 2 1']];
  data.wms=[stock(5,'A 001 01')];
  const row=reconcile(data).rows[0];
  assert.equal(row.multiple,true);
  assert.deepEqual(tableRow(row).originalLocations,['2B / 1 1']);
  assert.deepEqual(tableRow(row).loadedLocations,['A 001 01']);
});
test('espacios repetidos y alrededor de la barra son equivalentes, pero columna y nivel no se concatenan',()=>{
  assert.equal(octPositionKey(' 2a /5   5 '),octPositionKey('2A / 5 5'));
  assert.notEqual(octPositionKey('2A / 55'),octPositionKey('2A / 5 5'));
  const data=fixture();data.cross=[['2A 005 01','2A / 5 5']];data.wms=[stock(5,'2A 005 01')];
  data.octosis=[['SKU',5,'2A / 55','DISTRIMAR B']];
  const rows=reconcile(data).rows;
  assert.equal(rows.length,2);assert.equal(rows.find(row=>row.wmsPresent).oldPresent,false);
  assert.ok(rows.every(row=>!row.autoResolved));assert.equal(rows.reduce((sum,row)=>sum+row.oldQty,0),5);
  data.octosis=[['SKU',5,' 2a /5   5 ','DISTRIMAR B']];
  assert.equal(reconcile(data).rows[0].status,'Resuelto automáticamente');
});
test('relaciones explícitas con distintas separaciones no se fusionan aunque su clave compacta coincida',()=>{
  const data=fixture();
  data.cross=[['A 001 01','2B / 1 1'],['A 002 01','2B / 11']];
  data.octosis=[['SKU',5,'2B / 1 1','DISTRIMAR B'],['SKU',8,'2B / 11','DISTRIMAR B']];
  data.wms=[stock(5,'A 001 01'),stock(8,'A 002 01')];
  const rows=reconcile(data).rows;
  assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.oldQty).sort((a,b)=>a-b),[5,8]);
});
test('posiciones especiales provienen del cross y sin relación no se inventa una referencia Octosis',()=>{
  const data=fixture();data.cross=[['PUNTR 003 01','99FF/9999 ']];data.wms=[stock(84,'PUNTR 003 01'),stock(5,'2A 999 01')];
  const rows=reconcile(data).rows;
  assert.deepEqual(tableRow(rows.find(row=>row.wmsQty===84)).originalLocations,['99FF/9999']);
  const missing=rows.find(row=>row.wmsQty===5);
  assert.deepEqual(tableRow(missing).originalLocations,[]);assert.equal(missing.locationMatches,false);
});
test('la corrección de presentación conserva IDs y revisiones de relaciones válidas',()=>{
  let data=fixture();data.cross=[['2A 005 01','2A / 5 5']];data.octosis=[['SKU',5,'2A / 5 5','DISTRIMAR B']];data.wms=[stock(4,'2A 005 01')];
  const row=reconcile(data).rows[0];assert.equal(row.id,JSON.stringify(['o:2A/55','SKU']));
  data=applyAction(data,{id:row.id,action:'accept',reason:'Diferencia aceptada',expectedRevision:0},{email:C3_EMAILS[0],role:'C3'});
  data.cross=[['2A 005 01',' 2A / 5   5 ']];
  const after=reconcile(data).rows[0];
  assert.equal(after.id,row.id);assert.equal(after.status,'Aceptado');assert.equal(after.changed,false);
  assert.equal(data.events.length,1);
});
