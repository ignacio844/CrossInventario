import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';

function setup(){
 const properties=new Map(),cache=new Map(),clock={now:Date.parse('2026-11-07T10:00:00Z')};
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
 const context=vm.createContext({Date:FakeDate,
  Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,value)=>[...createHash(algorithm).update(value).digest()]},
  PropertiesService:{getScriptProperties:()=>({getProperties:()=>Object.fromEntries(properties),getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:key=>properties.delete(key)})},
  CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  Sheets:{Spreadsheets:{Values:{get:()=>({values:[['v2',context.data.revision],[JSON.stringify(context.data.meta)]]})}}}
 });
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 context.data={octosis:[],products:[],cross:[],wms:[['OLD',3,'A 001 01','','',3,'Anterior']],cases:{case:{status:'Aceptado C3'}},events:[],meta:{importId:'base'},revision:0};context.saves=0;
 vm.runInContext('load_=()=>data;save_=(next)=>{data=next;saves++;};',context);
 const call=(expression,args)=>{context.args=args;return vm.runInContext(expression,context);};
 const user={email:'supervisor@example.com',role:'C3'},token='worker-token-for-testing-only-with-at-least-40-characters';
 const pair=call("syncUser_('wms-pair',args)",user);
 call('syncWorker_(args)',{op:'worker-register',token:pair.code,body:{agentHash:'session:'+createHash('sha256').update(token).digest('hex')}});
 const worker=(op,body={})=>call('syncWorker_(args)',{op,token,body});
 const request=()=>call("syncUser_('wms-request',args)",{email:'operario@example.com',role:'C-Administrativo'});
 const payload=job=>({jobId:job.id,rows:[['NEW',7,'A 001 02','','',7,'Nuevo']],file:'TC_Stock.xlsx',capturedAt:new FakeDate().toISOString(),depot:'CD ESCOBAR',productionUrl:'https://wms.grupo-aftermarket.com:4446/SGLWMS_DISTRIMAR_PROD/hinicio.aspx'});
 return {context,clock,worker,request,payload,call};
}
test('botón y automático se agrupan en un único trabajo; solo un reclamo queda activo',()=>{
 const s=setup(),first=s.request(),second=s.request();
 assert.equal(second.coalesced,true);assert.equal(first.wmsSync.job.id,second.wmsSync.job.id);
 const claimed=s.worker('worker-poll');assert.equal(claimed.job.id,first.wmsSync.job.id);assert.equal(s.worker('worker-poll').job,null);
 assert.equal(s.request().coalesced,true);assert.equal(s.context.saves,0);
});
test('publicación de stock preserva correcciones y auditoría y es idempotente',()=>{
 const s=setup();s.request();const {job}=s.worker('worker-poll');
 s.context.data.revision=4;s.context.data.events.push({id:'correccion',action:'accept'});
 const result=s.worker('worker-complete',s.payload(job));assert.equal(result.rows,1);assert.equal(s.context.data.revision,5);
 assert.equal(s.context.data.cases.case.status,'Aceptado C3');assert.equal(s.context.data.events[0].id,'correccion');
 assert.equal(s.context.data.events[1].user,'operario@example.com');assert.equal(s.context.data.wms[0][0],'NEW');
 s.worker('worker-complete',s.payload(job));assert.equal(s.context.saves,1);
});
test('una importación manual posterior evita que la descarga vieja sobrescriba el stock',()=>{
 const s=setup();s.request();const {job}=s.worker('worker-poll');s.context.data.meta.importId='manual-mas-reciente';
 assert.throws(()=>s.worker('worker-complete',s.payload(job)),/otro stock/);assert.equal(s.context.saves,0);assert.equal(s.context.data.wms[0][0],'OLD');
});
test('rechaza otra URL o depósito y mantiene la foto anterior ante errores',()=>{
 const s=setup(),{job}=s.worker('worker-poll');
 assert.throws(()=>s.worker('worker-complete',{...s.payload(job),productionUrl:'https://example.com/TEST/hinicio.aspx'}),/producción/);
 assert.throws(()=>s.worker('worker-complete',{...s.payload(job),depot:'CD WARNES'}),/ESCOBAR/);
 s.worker('worker-error',{jobId:job.id,error:'Sin conexión'});assert.equal(s.context.saves,0);assert.equal(s.context.data.wms[0][0],'OLD');
 assert.equal(s.request().coalesced,false);
});
test('el ciclo automático respeta una hora y las credenciales desconocidas no se aceptan',()=>{
 const s=setup();const {job}=s.worker('worker-poll');s.worker('worker-complete',s.payload(job));
 assert.equal(s.worker('worker-poll').intervalSeconds,3600);s.clock.now+=3599000;assert.equal(s.worker('worker-poll').job,null);s.clock.now+=1000;assert.ok(s.worker('worker-poll').job);
 assert.throws(()=>s.call('syncWorker_(args)',{op:'worker-poll',token:'fake-token-with-at-least-40-characters-long'}),/autorizado/);
 assert.ok(s.call("syncUser_('wms-pair',args)",{email:'operario@example.com',role:'C-Administrativo'}).code);
});
test('el vencimiento de un trabajo impide confirmar una descarga interrumpida',()=>{
 const s=setup(),{job}=s.worker('worker-poll');s.clock.now+=181000;
 assert.throws(()=>s.worker('worker-complete',s.payload(job)),/activa/);assert.equal(s.context.saves,0);
});

test('el botón manual sigue disponible antes de una hora y actualiza el próximo ciclo',()=>{
 const s=setup(),first=s.worker('worker-poll');s.worker('worker-complete',s.payload(first.job));
 s.clock.now+=5*60*1000;assert.equal(s.worker('worker-poll').job,null);
 s.request();const manual=s.worker('worker-poll');assert.ok(manual.job);s.worker('worker-complete',s.payload(manual.job));
 s.clock.now+=3599000;assert.equal(s.worker('worker-poll').job,null);
 s.clock.now+=1000;assert.ok(s.worker('worker-poll').job);
});

test('una configuración histórica de cinco minutos adopta el nuevo intervalo sin reconectar el equipo',()=>{
 const s=setup(),value=s.call('syncRead_()');value.intervalSeconds=300;
 s.call('syncSave_(args)',value);assert.equal(s.call('syncRead_()').intervalSeconds,3600);
 assert.equal(s.call('syncPublic_()').intervalSeconds,3600);
 const first=s.worker('worker-poll');s.worker('worker-complete',s.payload(first.job));
 s.clock.now+=300000;assert.equal(s.worker('worker-poll').job,null);
});

test('la descarga guarda el cierre automático anterior junto al stock nuevo y su auditoría',()=>{
 const s=setup();
 s.context.data.cross=[['A 001 02','OLD']];s.context.data.products=[['NEW','Artículo',1]];
 s.context.data.octosis=[['NEW',7,'OLD','DISTRIMAR B']];s.context.data.wms=[['NEW',7,'A 001 02','','CONT',7,'Artículo']];
 const {job}=s.worker('worker-poll'),payload=s.payload(job);payload.rows=[['NEW',5,'A 001 02','','CONT',5,'Artículo']];
 s.worker('worker-complete',payload);
 const current=s.call("reconcile(data).rows.find(row=>row.sku==='NEW')");
 assert.equal(current.status,'Resuelto automáticamente');assert.equal(current.closurePreserved,true);assert.equal(current.review.snapshot.wmsQty,7);assert.equal(current.wmsQty,5);
 assert.equal(s.context.data.events.filter(event=>event.action==='auto-resolve').length,1);assert.equal(s.context.data.events.filter(event=>event.action==='import').length,1);
 s.worker('worker-complete',payload);assert.equal(s.context.saves,1);
});
