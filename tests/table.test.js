import test from 'node:test';
import assert from 'node:assert/strict';
import {tableRow,numberMatches,columnMatches} from '../src/table.js';

const base = {sku:'SKU',description:'Lámpara',oldDetails:[{position:'1A / 1 1'},{position:'1A / 1 1'}],oldPositions:['1A11','1A21'],wmsDetails:[{position:'1A 001 01'},{position:'1A 001 01'}],positions:['1A 001 01','1A 002 01'],oldPresent:true,wmsPresent:true,oldQty:2864,wmsQty:2863,delta:-1,saleUnit:1,kind:'Cantidad distinta',status:'Pendiente'};

test('tabla conserva posición Octosis original y muestra solo posiciones WMS del artículo ya cargadas',()=>{
  const row=tableRow(base);
  assert.deepEqual(row.originalLocations,['1A / 1 1']);
  assert.deepEqual(row.loadedLocations,['1A 001 01']);
  assert.deepEqual(tableRow({...base,wmsDetails:[],wmsPresent:false}).loadedLocations,[]);
  assert.deepEqual(tableRow({...base,oldDetails:[]}).originalLocations,['1A11','1A21']);
});
test('filtros por columna se combinan y encuentran posiciones originales con y sin separadores',()=>{
  const row=tableRow(base);
  assert.equal(columnMatches(row,{original:'1A11',loaded:'1A00101',article:'lampara',oldQty:'2.864',delta:'<0',status:'Pendiente'}),true);
  assert.equal(columnMatches(row,{loaded:'1A00201'}),false);
  assert.equal(columnMatches(row,{status:'Aceptado C3'}),false);
  assert.equal(columnMatches({...row,wmsPresent:false},{wmsQty:'0'}),false);
});
test('filtros numéricos admiten igualdad, comparaciones y formato local',()=>{
  assert.equal(numberMatches(2864,'2.864'),true);
  assert.equal(numberMatches(1.5,'1,5'),true);
  assert.equal(numberMatches(-1,'<=-1'),true);
  assert.equal(numberMatches(0,'!=0'),false);
  assert.equal(numberMatches(null,'0'),false);
  assert.equal(numberMatches(10,'abc'),false);
});
