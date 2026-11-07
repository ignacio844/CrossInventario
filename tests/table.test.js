import test from 'node:test';
import assert from 'node:assert/strict';
import {tableRow,numberMatches,columnMatches,sortRows,columnOptions,suggestValues,positionAisle,aisleOptions} from '../src/table.js';

const base = {sku:'SKU',description:'Lámpara',oldDetails:[{position:'1A / 1 1'},{position:'1A / 1 1'}],oldPositions:['1A11','1A21'],wmsDetails:[{position:'1A 001 01'},{position:'1A 001 01'}],positions:['1A 001 01','1A 002 01'],oldPresent:true,wmsPresent:true,oldQty:2864,wmsQty:2863,delta:-1,saleUnit:1,kind:'Cantidad distinta',status:'Pendiente'};

test('tabla conserva posición Octosis original y muestra solo posiciones WMS del artículo ya cargadas',()=>{
  const row=tableRow(base);
  assert.deepEqual(row.originalLocations,['1A / 1 1']);
  assert.deepEqual(row.loadedLocations,['1A 001 01']);
  assert.deepEqual(tableRow({...base,wmsDetails:[],wmsPresent:false}).loadedLocations,[]);
  assert.deepEqual(tableRow({...base,oldDetails:[]}).originalLocations,[]);
  assert.deepEqual(tableRow({...base,oldDetails:[],crossOriginalLocations:['1A / 1 1']}).originalLocations,['1A / 1 1']);
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

test('orden numérico global admite negativos, ambos sentidos y faltantes al final',()=>{
  const rows=Array.from({length:70},(_,i)=>({...tableRow(base),id:String(i),sku:'SKU'+i,wmsQty:i-20}));
  rows.push({...rows[0],id:'missing',wmsPresent:false});
  const ascending=sortRows(rows,{key:'wmsQty',direction:'asc'}),descending=sortRows(rows,{key:'wmsQty',direction:'desc'});
  assert.equal(ascending[0].wmsQty,-20);assert.equal(descending[0].wmsQty,49);
  assert.equal(ascending.at(-1).id,'missing');assert.equal(descending.at(-1).id,'missing');
  assert.equal(rows[0].id,'0');
});
test('orden de texto usa números naturales y las sugerencias conservan códigos de barras',()=>{
  const rows=['SKU10','SKU2'].map((sku,i)=>({...tableRow(base),id:sku,sku,barcode:i?'001234567890':'009999'}));
  assert.deepEqual(sortRows(rows,{key:'article',direction:'asc'}).map(row=>row.sku),['SKU2','SKU10']);
  assert.deepEqual(sortRows(rows,{key:'article',direction:'desc'}).map(row=>row.sku),['SKU10','SKU2']);
  const options=columnOptions(rows,'article');
  assert.deepEqual(suggestValues(options,'lampara','article'),['Lámpara']);
  assert.deepEqual(suggestValues(options,'00123','article'),['001234567890']);
  assert.deepEqual(suggestValues(columnOptions(rows,'original'),'1A11','original'),['1A / 1 1']);
  assert.ok(suggestValues(Array.from({length:100},(_,i)=>'SKU'+i),'SKU','article').length<=12);
});
test('sugerencias numéricas admiten cero, decimales y comparaciones; estado permite contenido parcial',()=>{
  const rows=[0,1.5,10].map(delta=>({...tableRow(base),delta}));
  assert.deepEqual(columnOptions(rows,'delta'),['0','1,5','10']);
  assert.deepEqual(suggestValues(columnOptions(rows,'delta'),'>1','delta'),['1,5','10']);
  assert.equal(columnMatches(tableRow(base),{status:'pend',kind:'distinta'}),true);
});

test('pasillos normalizan separadores sin confundir 2B con 12B ni 2BIS',()=>{
  for(const position of ['2B / 15 3',' 2b 015 03 ','2B01503','2 B / 15 3'])assert.equal(positionAisle(position),'2B');
  assert.equal(positionAisle('12B / 1 2'),'12B');
  assert.equal(positionAisle('2BIS 001 01'),'2BIS');
  assert.equal(positionAisle('PUNTR 012 01'),'PUNTR');
  assert.equal(positionAisle(null),'');assert.equal(positionAisle('12345'),'');
});
test('selección múltiple de pasillos usa OR por columna y AND con los demás filtros',()=>{
  const rows=['2B','2C','2D','12B','2BIS'].map(aisle=>tableRow({...base,id:aisle,oldDetails:[{position:aisle+' / 1 1'}]}));
  const selected=rows.filter(row=>columnMatches(row,{}, {original:['2B','2C']}));
  assert.deepEqual(selected.map(row=>row.id),['2B','2C']);
  assert.equal(columnMatches(rows[0],{article:'otro'}, {original:['2B','2C']}),false);
  assert.equal(columnMatches(rows[0],{delta:'>0'}, {original:['2B','2C']}),false);
  assert.ok(rows.every(row=>columnMatches(row,{}, {original:[]})));
});
test('Octosis y WMS filtran por sus propios pasillos y no muestran posiciones WMS previstas como cargadas',()=>{
  const row=tableRow({...base,oldDetails:[{position:'2B / 1 1'}],wmsDetails:[{position:'2C 001 01'}],positions:['2B 001 01','2C 001 01']});
  assert.equal(columnMatches(row,{}, {original:['2B'],loaded:['2C']}),true);
  assert.equal(columnMatches(row,{}, {loaded:['2B']}),false);
  assert.equal(columnMatches(tableRow({...base,wmsDetails:[]}),{}, {loaded:['2B']}),false);
  assert.deepEqual(aisleOptions([row],'original'),['2B']);assert.deepEqual(aisleOptions([row],'loaded'),['2C']);
});
test('un caso con varias posiciones aparece una vez y conserva sus cantidades completas',()=>{
  const row=tableRow({...base,oldDetails:[{position:'2B / 1 1'},{position:'2C / 2 1'},{position:'2B / 1 1'}]});
  const filtered=[row].filter(value=>columnMatches(value,{}, {original:['2B','2C']}));
  assert.equal(filtered.length,1);assert.equal(filtered[0].oldQty,base.oldQty);
  assert.deepEqual(filtered[0].originalLocations,['2B / 1 1','2C / 2 1']);
  assert.deepEqual(aisleOptions([row,row],'original'),['2B','2C']);
});
test('contenedores se conservan como texto y quedan asociados a su posición WMS real',()=>{
  const row=tableRow({...base,wmsDetails:[{position:'2B 001 01',container:'00123'},{position:'2B 001 01',container:'00123'},{position:'2B 001 01',container:'00124'},{position:'2C 002 01',container:'2Z-CONT'},{position:'2C 002 01',container:''}]});
  assert.deepEqual(row.loadedPositionDetails,[{position:'2B 001 01',containers:['00123','00124']},{position:'2C 002 01',containers:['2Z-CONT']}]);
  assert.deepEqual(new Set(row.containers),new Set(['00123','00124','2Z-CONT']));assert.equal(row.wmsQty,base.wmsQty);
  assert.deepEqual(aisleOptions([row],'loaded'),['2B','2C']);
  assert.equal(columnMatches(row,{loaded:'00123'}),true);
  assert.deepEqual(suggestValues(columnOptions([row],'loaded'),'00123','loaded'),['00123']);
  assert.deepEqual(tableRow({...base,wmsDetails:[]}).loadedPositionDetails,[]);
});
