// Generado por npm run build:apps-script. No pegar secretos aquí.
const C3_EMAILS = ['amilano@grupo-aftermarket.com','blas@grupo-aftermarket.com','ignacio@grupo-aftermarket.com','etelias@grupo-aftermarket.com','jpajon@grupo-aftermarket.com','mcrespo@tecnologisticaconsultores.com'];
const DEPOSITS = ['DISTRIMAR B','ALEMAR B','JUNIMAR B'];
const octKey = value => String(value??'').toUpperCase().replace(/\s+/g,'');
const wmsKey = value => String(value??'').trim().toUpperCase().replace(/\//g,' ').replace(/\s+/g,' ');
function fingerprint(value) { let hash=2166136261; for(const c of JSON.stringify(value)){ hash ^= c.charCodeAt(0); hash=Math.imul(hash,16777619); } return (hash>>>0).toString(36); }
function reconcile(data) {
  const parent=new Map();
  function root(x){ if(!parent.has(x))parent.set(x,x); if(parent.get(x)!==x)parent.set(x,root(parent.get(x))); return parent.get(x); }
  function union(a,b){a=root(a);b=root(b);if(a!==b)parent.set(a<b?b:a,a<b?a:b);}
  const oldLinks=new Map();
  for(const [w,o] of data.cross){const wk=wmsKey(w),ok=octKey(o); if(!wk||!ok)continue;union('w:'+wk,'o:'+ok);if(!oldLinks.has(ok))oldLinks.set(ok,new Set());oldLinks.get(ok).add(wk);}
  const groups=new Map();
  for(const node of parent.keys()){const id=root(node);if(!groups.has(id))groups.set(id,{old:[],positions:[]});groups.get(id)[node.startsWith('o:')?'old':'positions'].push(node.slice(2));}
  for(const g of groups.values()){g.old.sort();g.positions.sort();}
  const catalog=new Map(data.products.map(p=>[p[0],p]));const map=new Map();
  const make=(group,sku)=>{const id=JSON.stringify([group,sku]);if(!map.has(id))map.set(id,{id,group,sku,description:catalog.get(sku)?.[1]||'',saleUnit:catalog.get(sku)?.[2]??null,barcode:String(catalog.get(sku)?.[3]??''),oldQty:0,wmsQty:0,oldPresent:false,wmsPresent:false,oldDetails:[],wmsDetails:[],positions:groups.get(group)?.positions??[group.slice(2)],oldPositions:groups.get(group)?.old??[],mapped:groups.has(group)});return map.get(id);};
  for(const [sku,q,pos,dep] of data.octosis){if(!DEPOSITS.includes(dep))continue; const ok=octKey(pos);const group=parent.has('o:'+ok)?root('o:'+ok):'o:'+ok;const r=make(group,sku);r.oldPresent=true;r.oldQty+=q;r.oldDetails.push({position:pos,deposit:dep,quantity:q});}
  const active=new Set();
  for(const [sku,q,pos,depth,container,bultos,description] of data.wms){const wk=wmsKey(pos),group=parent.has('w:'+wk)?root('w:'+wk):'w:'+wk;active.add(group);const r=make(group,sku);r.wmsPresent=true;r.wmsQty+=q;if(!r.description)r.description=description;r.wmsDetails.push({position:wk,depth,container,quantity:q,bultos});}
  for(const pos of data.meta.seenWmsPositions??[]){const wk=wmsKey(pos);active.add(parent.has('w:'+wk)?root('w:'+wk):'w:'+wk);}
  const rows=[...map.values()].map(r=>{
    const group=groups.get(r.group);r.active=active.has(r.group);r.delta=r.wmsQty-r.oldQty;
    r.kind=!r.oldPresent?'Solo WMS':!r.wmsPresent?'Solo Octosis':r.delta!==0?'Cantidad distinta':'Coincide';
    r.multiple=!!group&&group.positions.length>1;
    r.expectedPositions=[...new Set(r.oldDetails.flatMap(d=>[...(oldLinks.get(octKey(d.position))||[])]))].sort();
    r.locationMatches=!r.wmsPresent?null:!r.mapped?false:!r.expectedPositions.length?null:r.wmsDetails.every(d=>r.expectedPositions.includes(wmsKey(d.position)));
    r.fingerprint=fingerprint([r.oldDetails.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),r.wmsDetails.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),r.positions,r.oldPositions,r.saleUnit]);
    const saved=data.cases[r.id];r.review=saved??{};r.changed=!!saved&&saved.fingerprint!==r.fingerprint;
    r.status=r.changed?'Revisar cambio':saved?.status??(r.active?'Pendiente':'Sin carga WMS');
    if(saved?.status==='Ajustado en WMS'&&r.changed)r.status='Verificar ajuste';
    return r;
  });
  rows.sort((a,b)=>Number(b.active)-Number(a.active)||a.positions[0].localeCompare(b.positions[0],undefined,{numeric:true})||a.sku.localeCompare(b.sku));
  return {rows,stats:{activeGroups:active.size,records:rows.filter(r=>r.active).length,missingUnits:rows.filter(r=>r.saleUnit==null).length,unmapped:rows.filter(r=>!r.mapped).length,ambiguousOld:[...oldLinks.values()].filter(s=>s.size>1).length},revision:data.revision,meta:data.meta};
}
function requiresReason(row,action){return !(action==='accept'&&row.kind==='Coincide'&&row.locationMatches===true);}
function applyAction(data,{id,action,reason,quantity,expectedRevision,requestId},user,now=new Date().toISOString()){
  if(!user?.email)throw new Error('Iniciá sesión para guardar.');
  if(requestId&&data.events.some(e=>e.requestId===requestId))return data;
  if(expectedRevision!==data.revision)throw Object.assign(new Error('Otro usuario actualizó los datos. Recargá y revisá antes de guardar.'),{status:409});
  const row=reconcile(data).rows.find(r=>r.id===id);if(!row||!row.active)throw new Error('El caso no tiene carga WMS registrada.');
  reason=String(reason??'').trim();
  if(requiresReason(row,action)&&!reason)throw new Error('Escribí un motivo o una observación.');
  if(reason.length>2000)throw new Error('La observación admite hasta 2.000 caracteres.');
  const actions={'request-c2':'Solicitado C2','record-c2':'C2 registrado','accept':'Aceptado C3','adjust':'Ajustado en WMS','verify':'Verificado C3','reopen':'Pendiente'};
  if(!actions[action])throw new Error('Acción desconocida.');
  if(['accept','adjust','verify','reopen'].includes(action)&&user.role!=='C3')throw Object.assign(new Error('Esta acción corresponde a C3.'),{status:403});
  if(['record-c2','adjust'].includes(action)&&(!Number.isFinite(quantity)||quantity<0))throw new Error('Indicá una cantidad válida, mayor o igual a cero.');
  if(action==='record-c2'&&row.status!=='Solicitado C2')throw new Error('Solicitá C2 antes de registrar su resultado.');
  if(action==='verify'){
    if(row.review.status!=='Ajustado en WMS'||data.meta.importId===row.review.adjustmentImportId)throw new Error('Importá una descarga posterior al ajuste para verificarlo.');
    if(row.wmsQty!==row.review.targetQuantity)throw new Error('WMS todavía no coincide con la cantidad ajustada registrada.');
  }
  const previous=data.cases[id]??null;
  const next={...previous,status:actions[action],reason:reason.trim(),updatedAt:now,updatedBy:user.email,fingerprint:row.fingerprint};
  if(action==='record-c2')next.c2={quantity,by:user.email,at:now,note:reason.trim()};
  if(action==='adjust'){next.targetQuantity=quantity;next.adjustmentImportId=data.meta.importId;}
  const event={id:requestId||crypto.randomUUID(),requestId,caseId:id,sku:row.sku,action,at:now,user:user.email,role:user.role,before:previous,after:next,wmsQty:row.wmsQty,oldQty:row.oldQty,source:data.meta.wmsFile,importId:data.meta.importId};
  return {...data,revision:data.revision+1,cases:{...data.cases,[id]:next},events:[...data.events,event]};
}

const SHEET_ID='1shb3TKCLMoIcnXMI0iViCq7HjGSeBvK-MoXyZSIvqig';
const GOOGLE_CLIENT_ID='1017155266531-5278r2b4svs70k4o2lu3o7hl8efvlgtk.apps.googleusercontent.com';
const TABLES={octosis:'Octosis',products:'Productos',cross:'Cross',wms:'WMS',cases:'Casos',events:'Historial',meta:'Control'};
const crypto={randomUUID:()=>Utilities.getUuid()};
function json_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
function pack_(v){return {packed:Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(v),'application/json')).getBytes())};}
function unpack_(v){if(!v.packed)return v;return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(v.packed),'application/gzip')).getDataAsString('UTF-8'));}
function fail_(message,status){const e=new Error(message);e.status=status||400;throw e;}
function sessionKey_(token){return 'session:'+Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,token).map(x=>(x&255).toString(16).padStart(2,'0')).join('');}
function sessionUser_(token){
 const key=sessionKey_(token),cache=CacheService.getScriptCache(),saved=cache.get(key)||PropertiesService.getScriptProperties().getProperty(key);
 if(!saved)fail_('La sesión venció. Volvé a ingresar.',401);
 const session=JSON.parse(saved);
 if(!session.email||session.expiresAt<=Date.now())fail_('La sesión venció. Volvé a ingresar.',401);
 cache.put(key,saved,Math.max(1,Math.min(300,Math.floor((session.expiresAt-Date.now())/1000))));
 return {email:session.email,role:C3_EMAILS.includes(session.email)?'C3':'C-Administrativo'};
}
function createSession_(user){
 const properties=PropertiesService.getScriptProperties(),now=Date.now();
 const existing=properties.getProperties();
 Object.keys(existing).filter(k=>k.indexOf('session:')===0).forEach(k=>{try{if(JSON.parse(existing[k]).expiresAt<=now)properties.deleteProperty(k);}catch(error){properties.deleteProperty(k);}});
 const token='s1.'+Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''),expiresAt=now+7*24*60*60*1000;
 properties.setProperty(sessionKey_(token),JSON.stringify({email:user.email,expiresAt}));
 return {token,expiresAt,user};
}
function user_(token){
 if(typeof token!=='string'||token.length>10000||!token)fail_('Iniciá sesión con Google.',401);
 if(token.indexOf('s1.')===0)return sessionUser_(token);
 const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,token).map(x=>(x&255).toString(16).padStart(2,'0')).join('');
 const cache=CacheService.getScriptCache(),cached=cache.get('user:'+digest);let p=cached?JSON.parse(cached):null;
 if(!p){const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(token),{muteHttpExceptions:true});if(response.getResponseCode()!==200)fail_('La sesión venció. Volvé a ingresar.',401);p=JSON.parse(response.getContentText());}
 const now=Math.floor(Date.now()/1000);
 if(p.aud!==GOOGLE_CLIENT_ID||!['accounts.google.com','https://accounts.google.com'].includes(p.iss)||!['true',true].includes(p.email_verified)||Number(p.exp)<=now||!p.email)fail_('Sesión Google inválida.',401);
 if(!cached)cache.put('user:'+digest,JSON.stringify({aud:p.aud,iss:p.iss,email_verified:p.email_verified,exp:p.exp,email:p.email}),Math.max(1,Math.min(300,Number(p.exp)-now)));
 const email=p.email.toLowerCase();return {email,role:C3_EMAILS.includes(email)?'C3':'C-Administrativo'};
}
function revision_(){
 const cache=CacheService.getScriptCache(),v=cache.get('revision');if(v!==null)return Number(v);
 const rows=Sheets.Spreadsheets.Values.get(SHEET_ID,"'Control'!A1:B2",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
 const rev=rows[0]?.[0]==='v2'?Number(rows[0][1]):Number(rows[1]?.[0]||0);cache.put('revision',String(rev),5);return rev;
}
function load_(withHistory){
 const keys=Object.keys(TABLES).filter(k=>withHistory||k!=='events'),ends={octosis:'D',products:'D',cross:'B',wms:'G',cases:'B',events:'B',meta:'B'};
 const results=Sheets.Spreadsheets.Values.batchGet(SHEET_ID,{ranges:keys.map(k=>"'"+TABLES[k]+"'!A:"+ends[k]),valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
 const all=Object.fromEntries(keys.map((k,i)=>[k,results[i].values||[]])),control=all.meta;
 return {octosis:all.octosis,products:all.products,cross:all.cross,wms:all.wms,cases:Object.fromEntries(all.cases.map(r=>[r[0],JSON.parse(r[1])])),events:withHistory?all.events.map(r=>JSON.parse(r[1])):[],meta:control[0]?.[0]==='v2'?JSON.parse(control.slice(1).map(r=>r[0]||'').join('')):JSON.parse(control[0]?.[0]||'{}'),revision:control[0]?.[0]==='v2'?Number(control[0][1]):Number(control[1]?.[0]||0)};
}
function save_(next,previous){
 const info=Sheets.Spreadsheets.get(SHEET_ID,{fields:'sheets.properties'}),ids=Object.fromEntries(info.sheets.map(s=>[s.properties.title,s.properties.sheetId]));const requests=[];
 for(const k of Object.keys(TABLES)){
  if(next[k]===previous[k]&&k!=='meta')continue;
  const meta=JSON.stringify(next.meta),control=[['v2',next.revision],...(meta.match(/[\s\S]{1,35000}/g)||['{}']).map(x=>[x])];
  const rows=k==='cases'?Object.entries(next.cases).map(([id,v])=>[id,JSON.stringify(v)]):k==='events'?next.events.map(e=>[e.id,JSON.stringify(e)]):k==='meta'?control:next[k];
  const oldCount=k==='cases'?Object.keys(previous.cases).length:k==='events'?previous.events.length:k==='meta'?Math.max(2,1+Math.ceil(JSON.stringify(previous.meta).length/35000)):previous[k].length;
  const size=Math.max(rows.length,oldCount,1),sheetId=ids[TABLES[k]];
  if(sheetId===undefined)fail_('Falta la pestaña '+TABLES[k]+' en la planilla.');
  requests.push({updateSheetProperties:{properties:{sheetId,gridProperties:{rowCount:Math.max(size,1000),columnCount:10}},fields:'gridProperties.rowCount,gridProperties.columnCount'}});
  const cells=rs=>rs.map(r=>({values:r.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}}))}));
  if(k==='events')requests.push({appendCells:{sheetId,rows:cells(rows.slice(previous.events.length)),fields:'userEnteredValue'}});
  else requests.push({updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:size,startColumnIndex:0,endColumnIndex:10},rows:cells(rows),fields:'userEnteredValue'}});
 }
 Sheets.Spreadsheets.batchUpdate({requests},SHEET_ID);
 CacheService.getScriptCache().put('revision',String(next.revision),5);
}
function validate_(type,rows,user){
 if(!['wms','cross','products','octosis'].includes(type))fail_('Tipo de archivo inválido.');
 if(type!=='wms'&&user.role!=='C3')fail_('Solo C3 puede reemplazar las referencias.',403);
 if(!Array.isArray(rows)||!rows.length||rows.length>100000)fail_('Cantidad de filas inválida.');
 const sizes={wms:7,cross:2,products:4,octosis:4},seen=new Set();
 for(const r of rows){
  if(!Array.isArray(r)||(r.length!==sizes[type]&&!(type==='products'&&r.length===3)))fail_('Estructura de columnas inválida.');
  if(!r[0]||typeof r[0]!=='string'||r[0].length>200)fail_('Código o posición inválidos.');
  if(r.some(v=>typeof v==='object'||typeof v==='string'&&v.length>3000))fail_('Contenido de celda inválido.');
  if(type==='cross'){if(typeof r[1]!=='string'||!r[1])fail_('Correspondencia incompleta.');}
  else {const q=type==='products'?r[2]:r[1];if(typeof q!=='number'||!Number.isFinite(q))fail_('Cantidad inválida.');if(type==='products'){if(q<=0)fail_('BULTO debe ser positivo.');if(seen.has(r[0]))fail_('Código duplicado en Productos.');seen.add(r[0]);}if(type==='octosis'&&!DEPOSITS.includes(r[3]))fail_('Depósito fuera del alcance.');if(type==='wms'&&(!r[2]||typeof r[5]!=='number'||!Number.isFinite(r[5])))fail_('Posición o bultos inválidos.');}
 }
 return rows;
}
function doGet(){return json_({service:'Control inventario Escobar',version:3,status:'ready',message:'Usar la app con sesión Google.'});}
function doPost(e){
 let lock;
 try{
  const input=JSON.parse(e.postData.contents);
  if(typeof input.op==='string'&&input.op.indexOf('worker-')===0)return json_(syncWorker_(input));
  const user=user_(input.token),body=unpack_(input.body||{});
  if(['wms-pair','wms-request'].includes(input.op))return json_(syncUser_(input.op,user));
  if(input.op==='session'){if(input.token.indexOf('s1.')===0)fail_('Ingresá nuevamente con Google para renovar la sesión.',401);return json_(createSession_(user));}
  if(input.op==='logout'){if(input.token.indexOf('s1.')===0){const key=sessionKey_(input.token);PropertiesService.getScriptProperties().deleteProperty(key);CacheService.getScriptCache().remove(key);}return json_({signedOut:true});}
  if(input.op==='state'&&input.revision!==null&&input.revision!==undefined&&Number(input.revision)===revision_())return json_({unchanged:true,revision:Number(input.revision),user,wmsSync:syncPublic_()});
  lock=LockService.getScriptLock();if(!lock.tryLock(20000))fail_('Hay otra operación en curso. Intentá nuevamente.',429);
  const writes=['action','import'].includes(input.op),data=load_(writes||input.op==='history');
  if(input.op==='state')return json_(pack_({rawState:data,user,wmsSync:syncPublic_()}));
  if(input.op==='history')return json_(pack_({events:data.events.filter(x=>!input.id||x.caseId===input.id).reverse()}));
  if(input.op==='preview'){validate_(body.type,body.rows,user);return json_({id:Utilities.getUuid(),rows:body.rows.length,previous:data[body.type].length,warnings:[],file:String(body.file||'archivo.xlsx').slice(0,255),revision:data.revision});}
  let next;
  if(input.op==='action')next=applyAction(data,body,user);
  else if(input.op==='import'){
   validate_(body.type,body.rows,user);
   if(!body.requestId||typeof body.requestId!=='string')fail_('Falta el identificador de operación.');
   if(data.events.some(x=>x.id===body.requestId))return json_(pack_({rawState:{...data,events:[]},user}));
   if(data.revision!==body.expectedRevision)fail_('Otro usuario actualizó los datos. Validá el archivo nuevamente.',409);
   const now=new Date().toISOString(),file=String(body.file||'archivo.xlsx').slice(0,255),meta={...data.meta,[body.type+'File']:file,[body.type+'ImportedAt']:now};
   if(body.type==='wms'){meta.importId=body.requestId;meta.importedAt=now;meta.wmsCapturedAt=null;meta.seenWmsPositions=[...new Set([...(data.meta.seenWmsPositions||[]),...data.wms.map(r=>r[2]),...body.rows.map(r=>r[2])])];}
   next={...data,[body.type]:body.rows,meta,revision:data.revision+1,events:[...data.events,{id:body.requestId,action:'import',type:body.type,at:now,user:user.email,role:user.role,file,rows:body.rows.length,previous:data[body.type].length}]};
  }else fail_('Operación desconocida.',404);
  if(next!==data)save_(next,data);
  return json_(pack_({rawState:{...next,events:[]},user}));
 }catch(err){return json_({status:err.status||400,error:err.message||'No se pudo completar la operación.'});}
 finally{if(lock&&lock.hasLock())lock.releaseLock();}
}
function comprobarConfiguracion(){const d=load_(false);console.log(JSON.stringify({sheetId:SHEET_ID,revision:d.revision,octosis:d.octosis.length,products:d.products.length,cross:d.cross.length,wms:d.wms.length}));}

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
