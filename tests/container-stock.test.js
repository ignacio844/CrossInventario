import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,applyAction} from '../src/domain.js';
import {tableRow} from '../src/table.js';

function source(){return {octosis:[['ORO1644',140,'2G /18 6','DISTRIMAR B']],wms:[['ORO1644',30,'2G 018 02','93','E51075',0,'FICHA'],['ORO1644',140,'2G 018 02','90','E51077',0,'FICHA']],products:[['ORO1644','FICHA',5]],cross:[['2G 018 02','2G /18 6']],cases:{},events:[],meta:{importId:'stock'},revision:0};}

test('ORO1644 muestra 30 y 140 separados por contenedor, sin duplicar Octosis ni la conciliación',()=>{
 const data=source(),before=JSON.stringify(data),rows=reconcile(data).rows,row=tableRow(rows[0]);
 assert.equal(rows.length,1);assert.equal(row.oldQty,140);assert.equal(row.wmsQty,170);assert.equal(row.delta,30);
 assert.deepEqual(row.wmsStockLines,[{position:'2G 018 02',container:'E51075',quantity:30},{position:'2G 018 02',container:'E51077',quantity:140}]);
 assert.equal(row.wmsStockLines.reduce((total,line)=>total+line.quantity,0),row.wmsQty);
 assert.equal(row.fingerprint,rows[0].fingerprint);assert.equal(row.caseVersion,rows[0].caseVersion);assert.equal(JSON.stringify(data),before);
 const saved=applyAction(data,{id:row.id,action:'accept',reason:'Control físico',expectedRevision:0,expectedCaseVersion:row.caseVersion,requestId:'accept-containers'},{email:'operario@example.test',role:'C-Administrativo'});
 assert.equal(saved.events.length,1);assert.equal(Object.keys(saved.cases).length,1);
 assert.deepEqual(tableRow(reconcile(saved).rows[0]).wmsStockLines,row.wmsStockLines);
});

test('el mismo contenedor en posiciones diferentes conserva saldos independientes y filas legítimas',()=>{
 const data=source();data.cross.push(['2G 019 02','2G /18 6']);
 data.wms.push(['ORO1644',5,'2G 018 02','94','E51075',0,'FICHA'],['ORO1644',-2,'2G 019 02','1','E51075',0,'FICHA'],['ORO1644',0,'2G 019 02','2','',0,'FICHA']);
 const row=tableRow(reconcile(data).rows[0]);
 assert.equal(row.wmsStockLines.find(line=>line.position==='2G 018 02'&&line.container==='E51075').quantity,35);
 assert.equal(row.wmsStockLines.find(line=>line.position==='2G 019 02'&&line.container==='E51075').quantity,-2);
 assert.equal(row.wmsStockLines.find(line=>line.container==='').quantity,0);
 assert.equal(row.wmsStockLines.reduce((total,line)=>total+line.quantity,0),row.wmsQty);
});

test('un único contenedor y una ausencia conservan sus saldos sin crear líneas ficticias',()=>{
 const data=source();data.wms=data.wms.slice(1);let row=tableRow(reconcile(data).rows[0]);
 assert.equal(row.wmsStockLines.length,1);assert.equal(row.wmsQty,140);assert.equal(row.autoResolved,true);
 data.wms=[];row=tableRow(reconcile(data).rows[0]);assert.deepEqual(row.wmsStockLines,[]);assert.equal(row.wmsPresent,false);
});
