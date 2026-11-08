import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPositionSummary,filterPositions,sortPositions} from '../src/positions.js';
import {reconcile,applyAction} from '../src/domain.js';

function fixture(){return {products:[['A','Lámpara',10,'000123'],['B','Bujía',1,'000456']],cross:[['2B 001 01','2B / 1 1'],['2C 001 01','2C / 1 1']],octosis:[['A',1000,'2B / 1 1','DISTRIMAR B'],['B',1,'2B / 1 1','ALEMAR B'],['A',4,'2C / 1 1','DISTRIMAR N'],['C',3,'9Z / 1 1','JUNIMAR B']],wms:[['A',1,'2B 001 01','','',1,''],['N',20,'2B 001 01','','',20,'']],meta:{importId:'stock'},cases:{},events:[],revision:0};}
const position=(summary,label)=>summary.rows.find(row=>row.original===label);

test('la cobertura cuenta códigos presentes por posición, independientemente de las cantidades',()=>{
 const summary=buildPositionSummary(fixture()),row=position(summary,'2B / 1 1');
 assert.equal(summary.stats.total,3);assert.equal(row.referenceCount,2);assert.equal(row.matchedCount,1);assert.equal(row.percentage,50);assert.equal(row.status,'Con carga');
 assert.equal(row.newCount,1);assert.equal(row.articles.find(article=>article.sku==='A').barcode,'000123');
 assert.equal(row.articles.find(article=>article.sku==='A').oldQty,1000);assert.equal(row.articles.find(article=>article.sku==='A').wmsQty,1);
});

test('Todos incluye pendientes, cargadas y posiciones sin correspondencia sin inventar porcentajes',()=>{
 const summary=buildPositionSummary(fixture());
 assert.equal(summary.stats.pending,1);assert.equal(summary.stats.loaded,1);assert.equal(summary.stats.unmapped,1);
 assert.equal(position(summary,'2C / 1 1').percentage,0);assert.equal(position(summary,'2C / 1 1').status,'Sin carga');
 assert.equal(position(summary,'9Z / 1 1').percentage,null);assert.equal(position(summary,'9Z / 1 1').status,'Sin cross');
 assert.equal(filterPositions(summary.rows,{status:'all'}).length,3);
 assert.equal(filterPositions(summary.rows,{status:'pending'})[0].original,'2C / 1 1');
});

test('duplicados legítimos y varios depósitos no duplican posiciones ni códigos de referencia',()=>{
 const data=fixture();data.octosis.push(['A',3,'2b/1 1','JUNIMAR B'],['A',5,'2B / 1 1','DISTRIMAR B']);data.cross.push(['2B 001 01','2B / 1 1']);
 const summary=buildPositionSummary(data),row=position(summary,'2B / 1 1');
 assert.equal(summary.stats.total,3);assert.equal(row.referenceCount,2);assert.equal(row.articles.find(article=>article.sku==='A').oldQty,1008);assert.equal(row.destinations.length,1);
});

test('una carga previa no vuelve a Sin carga aunque la última descarga quede vacía',()=>{
 const data=fixture();data.wms=[];data.meta.seenWmsPositions=['2B 001 01'];
 const summary=buildPositionSummary(data),row=position(summary,'2B / 1 1');
 assert.equal(row.status,'Con carga previa');assert.equal(row.percentage,0);assert.equal(row.hasCurrent,false);assert.equal(filterPositions(summary.rows,{status:'pending'}).some(value=>value.id===row.id),false);
 assert.equal(filterPositions(summary.rows,{status:'loaded'}).length,1);
});

test('el cross se aplica por vínculos directos: una carga transitiva no da por cargado otro origen',()=>{
 const data=fixture();data.cross=[['W 001 01','2B / 1 1'],['W 002 01','2B / 1 1'],['W 002 01','2C / 1 1'],['W 003 01','2C / 1 1']];data.wms=[['A',5,'W 003 01','','',5,'']];
 const summary=buildPositionSummary(data),first=position(summary,'2B / 1 1'),second=position(summary,'2C / 1 1');
 assert.equal(first.hasLoad,false);assert.equal(first.percentage,0);assert.equal(first.status,'Sin carga');assert.equal(first.sharedCross,true);
 assert.equal(second.hasLoad,true);assert.equal(second.percentage,100);
});

test('varios destinos y contenedores del mismo código aportan una sola coincidencia',()=>{
 const data=fixture();data.cross.push(['2B 001 02','2B / 1 1']);data.wms.push(['A',4,'2B 001 02','','OTHER',4,''],['A',3,'2B 001 01','','OTHER2',3,'']);
 const row=position(buildPositionSummary(data),'2B / 1 1');
 assert.equal(row.matchedCount,1);assert.equal(row.percentage,50);assert.equal(row.articles.find(article=>article.sku==='A').wmsQty,8);
});

test('WMS sin base Octosis conserva sus posiciones, con cobertura no calculable',()=>{
 const data=fixture();data.wms.push(['EXTRA',2,'W 999 01','','',2,'']);data.meta.seenWmsPositions=['PAST 001 01'];
 const summary=buildPositionSummary(data),extra=summary.rows.find(row=>row.wmsOnly==='W 999 01'),past=summary.rows.find(row=>row.wmsOnly==='PAST 001 01');
 assert.equal(extra.percentage,null);assert.equal(extra.hasCurrent,true);assert.equal(extra.mapped,false);assert.equal(extra.newCount,1);
 assert.equal(past.status,'Con carga previa');assert.equal(past.percentage,null);assert.equal(past.referenceCount,0);
 assert.ok(filterPositions(summary.rows,{status:'unmapped'}).includes(extra));assert.ok(filterPositions(summary.rows,{status:'loaded'}).includes(extra));
});

test('una correspondencia con carga pero sin stock positivo de Octosis no inventa una base',()=>{
 const data=fixture();data.cross.push(['NEW 001 01','3D / 1 1']);data.wms.push(['EXTRA',2,'NEW 001 01','','',2,'']);
 const row=position(buildPositionSummary(data),'3D / 1 1');assert.equal(row.mapped,true);assert.equal(row.status,'Con carga');assert.equal(row.percentage,null);assert.equal(row.referenceCount,0);
});

test('solo el saldo agregado positivo y los depósitos del operativo forman la referencia',()=>{
 const data=fixture();data.octosis.push(['ZERO',0,'2B / 1 1','DISTRIMAR B'],['NEGATIVE',-10,'2B / 1 1','DISTRIMAR B'],['OTHER',3,'2B / 1 1','OTRO DEPOSITO'],['N',-4,'8X / 1 1','DISTRIMAR B']);
 const summary=buildPositionSummary(data);assert.equal(position(summary,'2B / 1 1').referenceCount,2);assert.equal(summary.rows.some(row=>row.original==='8X / 1 1'),false);
});

test('columna y nivel conservan sus espacios y no se confunden posiciones distintas',()=>{
 const data=fixture();data.octosis=[['A',2,'1H / 13 2','DISTRIMAR B'],['A',2,'1H / 132','DISTRIMAR B']];data.cross=[['H 001 01','1H/13 2'],['H 002 01','1H/132']];data.wms=[['A',2,'H 001 01','','',2,'']];
 const summary=buildPositionSummary(data);assert.equal(summary.rows.length,2);assert.equal(position(summary,'1H / 13 2').percentage,100);assert.equal(position(summary,'1H / 132').percentage,0);
});

test('se combinan varios pasillos con OR y depósito y búsqueda con AND',()=>{
 const rows=buildPositionSummary(fixture()).rows;
 assert.equal(filterPositions(rows,{aisles:['2B','2C']}).length,2);
 assert.equal(filterPositions(rows,{aisles:['2B','2C'],deposit:'DISTRIMAR N'})[0].original,'2C / 1 1');
 assert.equal(filterPositions(rows,{query:'000123'}).length,2);
 assert.equal(filterPositions(rows,{query:'2B11'})[0].original,'2B / 1 1');
 assert.equal(filterPositions(rows,{aisles:['12B']}).length,0);
});

test('el orden de cobertura deja los no calculables al final en ambos sentidos',()=>{
 const rows=buildPositionSummary(fixture()).rows;
 assert.deepEqual(sortPositions(rows,{key:'coverage',direction:'asc'}).map(row=>row.percentage),[0,50,null]);
 assert.deepEqual(sortPositions(rows,{key:'coverage',direction:'desc'}).map(row=>row.percentage),[50,0,null]);
});

test('la proyección no cambia datos, estados, huellas de revisión ni el historial',()=>{
 const data=fixture(),before=structuredClone(data),control=reconcile(data);
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};freeze(data);
 buildPositionSummary(data);assert.deepEqual(data,before);assert.deepEqual(reconcile(data),control);
 const row=control.rows.find(row=>row.active),next=applyAction(data,{id:row.id,action:'accept',reason:'Revisado',expectedCaseVersion:row.caseVersion,requestId:'decision'}, {email:'operario@example.test',role:'C-Administrativo'});
 const stats=buildPositionSummary(data).stats;assert.deepEqual(buildPositionSummary(next).stats,stats);assert.equal(next.events.length,1);assert.equal(next.cases[row.id].status,'Aceptado');
});
