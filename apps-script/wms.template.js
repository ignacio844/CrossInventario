const WMS_PRODUCTION_URL='https://wms.grupo-aftermarket.com:4446/SGLWMS_DISTRIMAR_PROD/hinicio.aspx';
const WMS_SYNC_KEY='wms-sync-v1';
function syncRead_(){const value=PropertiesService.getScriptProperties().getProperty(WMS_SYNC_KEY);return value?JSON.parse(value):{enabled:false,intervalSeconds:300,job:null};}
function syncSave_(value){PropertiesService.getScriptProperties().setProperty(WMS_SYNC_KEY,JSON.stringify(value));CacheService.getScriptCache().remove(WMS_SYNC_KEY);}
function syncPublic_(){
 const cache=CacheService.getScriptCache();let saved=cache.get(WMS_SYNC_KEY);
 if(!saved){const value=syncRead_();saved=JSON.stringify({configured:!!PropertiesService.getScriptProperties().getProperty('wms-worker-hash'),enabled:!!value.enabled,intervalSeconds:300,lastHeartbeatAt:value.lastHeartbeatAt||null,lastSuccessAt:value.lastSuccessAt||null,lastRows:value.lastRows||0,lastError:value.lastError||null,job:value.job?{id:value.job.id,status:value.job.status,stage:value.job.stage,requestedAt:value.job.requestedAt,requestedBy:value.job.requestedBy,trigger:value.job.trigger,startedAt:value.job.startedAt,finishedAt:value.job.finishedAt,error:value.job.error}:null});cache.put(WMS_SYNC_KEY,saved,5);}
 const result=JSON.parse(saved);result.connected=!!result.lastHeartbeatAt&&Date.now()-Date.parse(result.lastHeartbeatAt)<60000;result.productionUrl=WMS_PRODUCTION_URL;return result;
}
function syncLock_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(20000))fail_('Hay otra operación en curso. Reintentá en unos segundos.',429);try{return fn();}finally{lock.releaseLock();}}
function syncExpire_(sync,now){if(sync.job&&sync.job.status==='running'&&sync.job.leaseUntil<now){sync.job.status='error';sync.job.error='El equipo dejó de responder durante la descarga.';sync.job.finishedAt=new Date(now).toISOString();sync.lastError=sync.job.error;}}
function syncQueue_(sync,trigger,requestedBy){const now=Date.now();syncExpire_(sync,now);if(sync.job&&['pending','running'].includes(sync.job.status))return false;sync.job={id:Utilities.getUuid(),status:'pending',stage:'Pendiente',requestedAt:new Date(now).toISOString(),requestedBy,trigger};sync.lastError=null;return true;}
function syncUser_(op,user){return syncLock_(()=>{
 const properties=PropertiesService.getScriptProperties(),sync=syncRead_();
 if(op==='wms-pair'){
  if(user.role!=='C3')fail_('Solo C3 puede conectar el equipo de descarga.',403);
  const code=Utilities.getUuid().replace(/-/g,''),expiresAt=Date.now()+10*60*1000;
  properties.setProperty('wms-pair',JSON.stringify({hash:sessionKey_(code),expiresAt,by:user.email}));
  return {code,expiresAt,productionUrl:WMS_PRODUCTION_URL};
 }
 if(op==='wms-request'){
  if(!properties.getProperty('wms-worker-hash'))fail_('Primero C3 debe conectar el equipo de descarga.',503);
  const created=syncQueue_(sync,'manual',user.email);syncSave_(sync);return {coalesced:!created,wmsSync:syncPublic_()};
 }
 fail_('Operación de stock desconocida.',404);
});}
function syncMeta_(){const control=Sheets.Spreadsheets.Values.get(SHEET_ID,"'Control'!A:B",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];return control[0]&&control[0][0]==='v2'?JSON.parse(control.slice(1).map(r=>r[0]||'').join('')):JSON.parse(control[0]&&control[0][0]||'{}');}
function syncWorker_(input){return syncLock_(()=>{
 const properties=PropertiesService.getScriptProperties();
 if(input.op==='worker-register'){
  const saved=properties.getProperty('wms-pair'),pair=saved?JSON.parse(saved):null,body=input.body||{};
  if(!pair||pair.expiresAt<Date.now()||typeof input.token!=='string'||sessionKey_(input.token)!==pair.hash)fail_('Código de conexión inválido o vencido.',401);
  if(typeof body.agentHash!=='string'||!/^session:[a-f0-9]{64}$/.test(body.agentHash))fail_('Identificador del equipo inválido.');
  properties.setProperty('wms-worker-hash',body.agentHash);properties.deleteProperty('wms-pair');
  const sync=syncRead_();sync.enabled=true;sync.lastHeartbeatAt=new Date().toISOString();syncSave_(sync);
  return {ok:true,intervalSeconds:300,productionUrl:WMS_PRODUCTION_URL};
 }
 if(typeof input.token!=='string'||input.token.length<40||sessionKey_(input.token)!==properties.getProperty('wms-worker-hash'))fail_('Equipo no autorizado.',401);
 const body=unpack_(input.body||{}),sync=syncRead_(),now=Date.now();syncExpire_(sync,now);sync.lastHeartbeatAt=new Date(now).toISOString();
 if(input.op==='worker-poll'){
  if(sync.enabled&&(!sync.lastAttemptAt||now-Date.parse(sync.lastAttemptAt)>=300000))syncQueue_(sync,'automatic','Automático WMS');
  if(sync.job&&sync.job.status==='pending'){
   const meta=syncMeta_();sync.job.status='running';sync.job.stage='Descargando stock';sync.job.startedAt=new Date(now).toISOString();sync.job.leaseUntil=now+180000;sync.job.baseImportId=meta.importId||null;sync.lastAttemptAt=sync.job.startedAt;
   syncSave_(sync);return {job:{id:sync.job.id,startedAt:sync.job.startedAt},intervalSeconds:300,productionUrl:WMS_PRODUCTION_URL};
  }
  syncSave_(sync);return {job:null,intervalSeconds:300};
 }
 const job=sync.job;
 if(!job||job.id!==body.jobId)fail_('La solicitud ya no está vigente.',409);
 if(input.op==='worker-complete'&&job.status==='done')return {ok:true,rows:sync.lastRows,jobId:job.id};
 if(job.status!=='running')fail_('La descarga ya no está activa.',409);
 if(input.op==='worker-progress'){job.leaseUntil=now+180000;job.stage=String(body.stage||job.stage).slice(0,100);syncSave_(sync);return {ok:true};}
 if(input.op==='worker-error'){job.status='error';job.error=String(body.error||'Falló la descarga de WMS.').slice(0,500);job.finishedAt=new Date(now).toISOString();sync.lastError=job.error;syncSave_(sync);return {ok:true};}
 if(input.op!=='worker-complete')fail_('Operación del equipo desconocida.',404);
 if(body.productionUrl!==WMS_PRODUCTION_URL||body.depot!=='CD ESCOBAR')fail_('Solo se admite stock de CD ESCOBAR en producción.');
 validate_('wms',body.rows,{role:'C-Administrativo'});
 const captured=Date.parse(body.capturedAt);if(!Number.isFinite(captured)||captured<Date.parse(job.startedAt)-30000||captured>now+300000)fail_('La fecha de la descarga no es válida.');
 const data=load_(true),existing=data.events.find(e=>e.id===job.id);
 if(!existing){
  if((data.meta.importId||null)!==job.baseImportId){job.status='error';job.error='Se importó otro stock mientras se descargaba. Pedí una nueva descarga.';job.finishedAt=new Date(now).toISOString();sync.lastError=job.error;syncSave_(sync);fail_(job.error,409);}
  const at=new Date(now).toISOString(),file=String(body.file||'TC_Stock.xlsx').slice(0,255),meta={...data.meta,wmsFile:file,wmsImportedAt:at,importedAt:at,wmsCapturedAt:body.capturedAt,importId:job.id,wmsProductionUrl:WMS_PRODUCTION_URL,seenWmsPositions:[...new Set([...(data.meta.seenWmsPositions||[]),...data.wms.map(r=>r[2]),...body.rows.map(r=>r[2])])]};
  const event={id:job.id,action:'import',type:'wms',at,user:job.requestedBy,role:'Descargador WMS',trigger:job.trigger,file,rows:body.rows.length,previous:data.wms.length,source:WMS_PRODUCTION_URL};
  save_({...data,wms:body.rows,meta,revision:data.revision+1,events:[...data.events,event]},data);
 }
 job.status='done';job.stage='Stock actualizado';job.finishedAt=new Date(now).toISOString();sync.lastSuccessAt=job.finishedAt;sync.lastRows=body.rows.length;sync.lastError=null;syncSave_(sync);
 return {ok:true,rows:body.rows.length,jobId:job.id};
});}
