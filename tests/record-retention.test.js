import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../src/demo.js';
import {applyAction,reconcile,actionReceipt} from '../src/domain.js';
import {assertActionConfirmed} from '../src/transport.js';

const user={email:'operario@example.test',role:'C-Administrativo'};
const clock='2026-11-08T12:00:00Z';
const onlyWms=data=>reconcile(data).rows.find(row=>row.sku==='DEMO-RELE-02');
function save(data,row,action,extra={}){
 const payload={id:row.id,action,reason:'Control físico realizado',expectedRevision:data.revision,expectedCaseVersion:row.caseVersion,requestId:crypto.randomUUID(),...extra};
 return [applyAction(data,payload,user,clock),payload];
}

test('una corrección a cero conserva el caso, su observación y el historial aunque desaparezca de ambas fuentes',()=>{
 const source=demoData(),row=onlyWms(source),[saved]=save(source,row,'accept');
 const next={...saved,wms:saved.wms.filter(stock=>stock[0]!==row.sku),meta:{...saved.meta,importId:'posterior'}};
 const retained=reconcile(next).rows.find(value=>value.id===row.id);
 assert.ok(retained);assert.equal(retained.historicalOnly,true);assert.equal(retained.wmsPresent,false);assert.equal(retained.oldPresent,false);
 assert.equal(retained.oldQty,0);assert.equal(retained.wmsQty,0);assert.equal(retained.kind,'No figura en fuentes');
 assert.equal(retained.status,'Revisar cambio');assert.equal(retained.review.status,'Aceptado');assert.equal(retained.review.reason,'Control físico realizado');
 assert.equal(retained.review.snapshot.wmsQty,12);assert.equal(next.events.length,1);
 assert.deepEqual(retained.wmsDetails,[]);assert.ok(retained.crossOriginalLocations.every(position=>source.cross.some(link=>link[1]===position)));
 assert.equal(reconcile(next).rows.filter(value=>value.id===row.id).length,1);
});

test('stock en otro grupo se informa sin atribuirlo a la ubicación original ni duplicar saldos',()=>{
 const source=demoData(),row=onlyWms(source),[saved]=save(source,row,'request-c2');
 const moved={...saved,wms:saved.wms.map(stock=>stock[0]===row.sku?[stock[0],stock[1],'1A 001 02',...stock.slice(3)]:stock)};
 const rows=reconcile(moved).rows,old=rows.find(value=>value.id===row.id),other=rows.find(value=>value.sku===row.sku&&value.wmsPresent);
 assert.equal(old.wmsPresent,false);assert.equal(old.wmsQty,0);assert.equal(old.otherWms.length,1);
 assert.deepEqual(old.otherWms[0].positions,['1A 001 02']);assert.equal(old.otherWms[0].id,other.id);
 assert.equal(rows.filter(value=>value.sku===row.sku).reduce((sum,value)=>sum+value.wmsQty,0),12);
});

test('C2 puede registrar el resultado de una solicitud aunque el stock haya cambiado desde la solicitud',()=>{
 const source=demoData(),row=onlyWms(source),[saved]=save(source,row,'request-c2');
 const changed={...saved,wms:saved.wms.filter(stock=>stock[0]!==row.sku)};
 const retained=reconcile(changed).rows.find(value=>value.id===row.id);
 assert.equal(retained.status,'Revisar cambio');
 const [result]=save(changed,retained,'record-c2',{quantity:0});assert.equal(result.cases[row.id].c2.quantity,0);assert.equal(result.events.length,2);
});

test('el ajuste queda registrado y puede verificarse en cero sin inventar stock en la descarga',()=>{
 const source=demoData(),row=onlyWms(source),[saved]=save(source,row,'adjust',{quantity:0});
 assert.equal(saved.wms,source.wms);assert.equal(saved.cases[row.id].targetQuantity,0);
 const next={...saved,wms:saved.wms.filter(stock=>stock[0]!==row.sku),meta:{...saved.meta,importId:'posterior',wmsCapturedAt:'2026-11-08T12:05:00Z'}};
 const retained=reconcile(next).rows.find(value=>value.id===row.id);
 const [verified]=save(next,retained,'verify');assert.equal(verified.cases[row.id].status,'Verificado');assert.equal(verified.events.length,2);
});

test('una exportación capturada antes del ajuste no lo confirma aunque termine de importarse después',()=>{
 const source=demoData(),row=onlyWms(source),[saved]=save(source,row,'adjust',{quantity:12});
 const next={...saved,meta:{...saved.meta,importId:'new-id',wmsCapturedAt:'2026-11-08T11:59:00Z'}};
 assert.throws(()=>save(next,onlyWms(next),'verify'),/antes del ajuste/);
});

test('la confirmación relaciona la acción y su evento; el cliente conserva el borrador si falta o no corresponde',()=>{
 const source=demoData(),row=onlyWms(source),[saved,payload]=save(source,row,'accept');
 const receipt=actionReceipt(saved,payload);assertActionConfirmed({receipt},payload);
 assert.equal(receipt.confirmed,true);assert.equal(receipt.requestId,saved.events[0].id);
 assert.throws(()=>assertActionConfirmed({},payload),/no confirmó/);
 assert.throws(()=>assertActionConfirmed({receipt:{...receipt,requestId:'otra'}},payload),/no confirmó/);
 assert.throws(()=>actionReceipt(source,payload),/No se pudo confirmar/);
});

test('reintentar una acción confirmada no duplica el historial ni cambia su snapshot',()=>{
 const source=demoData(),row=onlyWms(source),[saved,payload]=save(source,row,'accept');
 const result=applyAction(saved,payload,user);assert.equal(result,saved);assert.equal(result.events.length,1);
 assertActionConfirmed({receipt:actionReceipt(result,payload)},payload);
});

test('un cambio de cross conserva un caso histórico separado sin trasladar su aceptación a otro grupo',()=>{
 const source=demoData(),row=onlyWms(source),[saved]=save(source,row,'accept');
 const next={...saved,cross:[],wms:saved.wms.filter(stock=>stock[0]!==row.sku)};
 const retained=reconcile(next).rows.find(value=>value.id===row.id);
 assert.ok(retained);assert.equal(retained.mapped,false);assert.deepEqual(retained.positions,[]);assert.equal(retained.wmsPresent,false);
});
