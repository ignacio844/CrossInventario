import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcile,applyAction,isResolved,preserveAutomaticClosures} from '../src/domain.js';
import {tableRow,matchesReviewFilter} from '../src/table.js';

const user={email:'operario@example.test',role:'C-Administrativo'},at='2026-11-09T14:00:00Z';
const source=()=>({products:[['SKU','Artículo',1]],octosis:[['SKU',100,'2B / 1 1','DISTRIMAR B']],wms:[['SKU',95,'2B 001 01','1','CONT-A',19,'Artículo']],cross:[['2B 001 01','2B / 1 1']],cases:{},events:[],meta:{importId:'ayer',wmsCapturedAt:at},revision:0});
const row=data=>reconcile(data).rows.find(row=>row.sku==='SKU');
function save(data,action,extra={}){const current=row(data);return applyAction(data,{id:current.id,action,reason:'Control realizado',expectedRevision:data.revision,expectedCaseVersion:current.caseVersion,requestId:crypto.randomUUID(),...extra},user,at);}
const changeQuantity=(data,quantity)=>({...data,wms:data.wms.map(stock=>[stock[0],quantity,...stock.slice(2)]),meta:{...data.meta,importId:'hoy'}});

test('cantidades posteriores restauran el cierre sin reescribir decisiones ni confundir su diferencia',()=>{
 const saved=save(source(),'accept'),changed=changeQuantity(saved,70),before=JSON.stringify(changed),result=tableRow(row(changed));
 assert.equal(result.status,'Aceptado');assert.equal(result.closurePreserved,true);assert.equal(result.changed,true);assert.equal(isResolved(result),true);
 assert.equal(result.wmsQty,70);assert.equal(result.delta,-30);assert.equal(result.pendingDelta,0);assert.equal(result.reviewedDelta,-5);assert.equal(result.postReviewDelta,-25);
 assert.equal(matchesReviewFilter(result,'analysis'),false);assert.equal(matchesReviewFilter(result,'post-review'),true);assert.equal(result.review.reason,'Control realizado');assert.equal(result.review.updatedAt,at);
 assert.equal(JSON.stringify(changed),before);assert.equal(changed.events.length,1);
});

test('cierres anteriores a esta versión se recuperan por su snapshot y fecha de referencia',()=>{
 const saved=save(source(),'accept'),id=row(saved).id;delete saved.cases[id].referenceFingerprint;
 assert.equal(row(changeQuantity(saved,80)).status,'Aceptado');
 const changed=changeQuantity(saved,80);changed.meta.crossImportedAt='2026-11-10T12:00:00Z';assert.equal(row(changed).status,'Revisar cambio');
 saved.cases[id].snapshot.oldQty=99;assert.equal(row(changeQuantity(saved,80)).status,'Revisar cambio');
});

test('un cierre legado sin detalle no atribuye la diferencia actual a lo aceptado',()=>{
 const saved=save(source(),'accept'),id=row(saved).id;delete saved.cases[id].snapshot;delete saved.cases[id].referenceFingerprint;
 const result=tableRow(row(changeQuantity(saved,80)));assert.equal(result.status,'Aceptado');assert.equal(result.pendingDelta,0);assert.equal(result.reviewedDelta,null);assert.equal(result.acceptedDifference,false);assert.equal(result.observation,'Cierre conservado');
});

test('agotarse el stock conserva el cierre, sin fabricar stock físico ni ubicaciones actuales',()=>{
 const saved=save(source(),'accept'),changed={...saved,wms:[]},result=tableRow(row(changed));
 assert.equal(result.status,'Aceptado');assert.equal(result.wmsPresent,false);assert.deepEqual(result.loadedLocations,[]);assert.equal(result.postReviewDelta,null);assert.equal(result.pendingDelta,0);
});

test('cambios de Octosis, cross, unidad o posición WMS nueva siguen requiriendo revisión',()=>{
 const saved=save(source(),'accept');
 for(const mutate of [data=>{data.octosis[0][1]=101;},data=>{data.products[0][2]=10;},data=>{data.cross.push(['2B 002 01','2B / 1 1']);},data=>{data.cross.push(['2B 002 01','2B / 1 1']);data.wms[0][2]='2B 002 01';}]){
  const changed=structuredClone(saved);mutate(changed);assert.equal(row(changed).status,'Revisar cambio');assert.equal(row(changed).closurePreserved,false);
 }
});

test('la reapertura manual conserva su efecto y C2 o ajustes pendientes no se cierran por arrastre',()=>{
 const matched=source();matched.wms[0][1]=100;
 const reopened=save(save(matched,'accept'),'reopen');assert.equal(row(reopened).status,'Pendiente');assert.equal(row(reopened).autoResolved,false);
 for(const action of ['request-c2','adjust']){const saved=save(source(),action,action==='adjust'?{quantity:100}:{});const changed=row(changeQuantity(saved,70));assert.equal(isResolved(changed),false);assert.equal(changed.closurePreserved,false);}
});

test('la coincidencia automática se registra antes del cambio de stock y permanece confirmada',()=>{
 const matched=source();matched.wms[0][1]=100;const incoming=changeQuantity(matched,80).wms;
 const checkpoint=preserveAutomaticClosures(matched,incoming,'2026-11-10T12:00:00Z');
 assert.equal(Object.keys(checkpoint.cases).length,1);assert.equal(checkpoint.events.length,1);assert.equal(checkpoint.events[0].action,'auto-resolve');
 const changed={...checkpoint,wms:incoming,meta:{...checkpoint.meta,importId:'hoy'}},result=tableRow(row(changed));
 assert.equal(result.status,'Resuelto automáticamente');assert.equal(result.pendingDelta,0);assert.equal(result.reviewedDelta,0);assert.equal(result.postReviewDelta,-20);assert.equal(result.observation,'Inventario confirmado');
 assert.equal(preserveAutomaticClosures(changed,changeQuantity(changed,70).wms),changed);
 assert.equal(matched.events.length,0);assert.deepEqual(matched.cases,{});
});

test('no crea cierres para nuevas diferencias ni reemplaza solicitudes C2 existentes',()=>{
 const data=source();assert.equal(preserveAutomaticClosures(data,changeQuantity(data,70).wms),data);
 const c2=save(data,'request-c2');c2.wms[0][1]=100;assert.equal(preserveAutomaticClosures(c2,changeQuantity(c2,70).wms),c2);
});
