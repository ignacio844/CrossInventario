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
function revision_(fresh=false){
 const cache=CacheService.getScriptCache(),v=cache.get('revision');if(!fresh&&v!==null)return Number(v);
 quotaGuard_();
 const rows=Sheets.Spreadsheets.Values.get(SHEET_ID,"'Control'!A1:B2",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
 const rev=rows[0]?.[0]==='v2'?Number(rows[0][1]):Number(rows[1]?.[0]||0);const current=Math.max(rev,Number(cache.get('revision')||0));cache.put('revision',String(current),30);return current;
}
function load_(withHistory){
 quotaGuard_();
 const keys=Object.keys(TABLES).filter(k=>withHistory||k!=='events'),ends={octosis:'D',products:'D',cross:'B',wms:'G',cases:'B',events:'B',meta:'B'};
 const results=Sheets.Spreadsheets.Values.batchGet(SHEET_ID,{ranges:keys.map(k=>"'"+TABLES[k]+"'!A:"+ends[k]),valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
 const all=Object.fromEntries(keys.map((k,i)=>[k,results[i].values||[]])),control=all.meta;
 return {octosis:all.octosis,products:all.products,cross:all.cross,wms:all.wms,cases:Object.fromEntries(all.cases.map(r=>[r[0],JSON.parse(r[1])])),events:withHistory?all.events.map(r=>JSON.parse(r[1])):[],meta:control[0]?.[0]==='v2'?JSON.parse(control.slice(1).map(r=>r[0]||'').join('')):JSON.parse(control[0]?.[0]||'{}'),revision:control[0]?.[0]==='v2'?Number(control[0][1]):Number(control[1]?.[0]||0)};
}
function save_(next,previous){
 const info=sheetInfo_(),properties=Object.fromEntries(info.sheets.map(sheet=>[sheet.properties.title,sheet.properties])),ids=Object.fromEntries(info.sheets.map(s=>[s.properties.title,s.properties.sheetId]));const requests=[];
 for(const k of Object.keys(TABLES)){
  if(next[k]===previous[k]&&k!=='meta')continue;
  const meta=JSON.stringify(next.meta),control=[['v2',next.revision],...(meta.match(/[\s\S]{1,35000}/g)||['{}']).map(x=>[x])];
  const rows=k==='cases'?Object.entries(next.cases).map(([id,v])=>[id,JSON.stringify(v)]):k==='events'?next.events.map(e=>[e.id,JSON.stringify(e)]):k==='meta'?control:next[k];
  const oldCount=k==='cases'?Object.keys(previous.cases).length:k==='events'?previous.events.length:k==='meta'?Math.max(2,1+Math.ceil(JSON.stringify(previous.meta).length/35000)):previous[k].length;
  const size=Math.max(rows.length,oldCount,1),sheetId=ids[TABLES[k]];
  if(sheetId===undefined)fail_('Falta la pestaña '+TABLES[k]+' en la planilla.');
  const grid=properties[TABLES[k]].gridProperties||{};
  if((grid.rowCount||0)<size||(grid.columnCount||0)<10)requests.push({updateSheetProperties:{properties:{sheetId,gridProperties:{rowCount:Math.max(size,grid.rowCount||0,1000),columnCount:Math.max(10,grid.columnCount||0)}},fields:'gridProperties.rowCount,gridProperties.columnCount'}});
  const cells=rs=>rs.map(r=>({values:r.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}}))}));
  if(k==='cases'){
   const indices=new Map(Object.keys(previous.cases).map((id,index)=>[id,index])),appended=[];
   for(const [id,value] of Object.entries(next.cases))if(value!==previous.cases[id]){
    if(indices.has(id))requests.push({updateCells:{start:{sheetId,rowIndex:indices.get(id),columnIndex:0},rows:cells([[id,JSON.stringify(value)]]),fields:'userEnteredValue'}});
    else appended.push([id,JSON.stringify(value)]);
   }
   if(appended.length)requests.push({updateCells:{start:{sheetId,rowIndex:indices.size,columnIndex:0},rows:cells(appended),fields:'userEnteredValue'}});
  }
  else if(k==='meta'&&next.meta===previous.meta&&previous.controlV2!==false)requests.push({updateCells:{start:{sheetId,rowIndex:0,columnIndex:1},rows:cells([[next.revision]]),fields:'userEnteredValue'}});
  else if(k==='events')requests.push({appendCells:{sheetId,rows:cells(rows.slice(previous.events.length)),fields:'userEnteredValue'}});
  else requests.push({updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:size,startColumnIndex:0,endColumnIndex:10},rows:cells(rows),fields:'userEnteredValue'}});
 }
 Sheets.Spreadsheets.batchUpdate({requests},SHEET_ID);
 try{cacheReview_(next,true);if(next.meta!==previous.meta)cacheSources_('sources-v1:'+sourceStamp_(next.meta),Object.fromEntries(['octosis','products','cross','wms'].map(key=>[key,next[key]])));if(requests.some(request=>request.updateSheetProperties))CacheService.getScriptCache().remove?.('sheet-properties-v1');}catch(error){}
 CacheService.getScriptCache().put('revision',String(next.revision),30);
}
function validate_(type,rows,user){
 if(!['wms','cross','products','octosis'].includes(type))fail_('Tipo de archivo inválido.');
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
  if(input.op==='state')return json_(pack_({rawState:loadSnapshot_(input.revision===null||input.revision===undefined),user,wmsSync:syncPublic_()}));
  if(input.op==='history')return json_(pack_(loadHistory_(input.id)));
  if(input.op==='preview'){validate_(body.type,body.rows,user);const control=readControl_(),sources=loadSources_(control);return json_({id:Utilities.getUuid(),rows:body.rows.length,previous:sources[body.type].length,warnings:[],file:String(body.file||'archivo.xlsx').slice(0,255),revision:control.revision});}
  let data,sources,control;
  if(input.op==='action'){quotaGuard_();control=actionControl_();sources=loadSources_(control);}
  lock=LockService.getScriptLock();if(!lock.tryLock(2000))busy_();
  if(input.op==='action'){
   const review=actionReview_();if(sourceStamp_(review.meta)!==sourceStamp_(control.meta))busy_();data={...sources,...review};
  }else data=load_(true);
  let next;
  if(input.op==='action')next=applyAction(data,body,user);
  else if(input.op==='import'){
   validate_(body.type,body.rows,user);
   if(!body.requestId||typeof body.requestId!=='string')fail_('Falta el identificador de operación.');
   if(data.events.some(x=>x.id===body.requestId))return json_(pack_({rawState:{...data,events:[]},user}));
   if(data.revision!==body.expectedRevision)fail_('Otro usuario actualizó los datos. Validá el archivo nuevamente.',409);
   const now=new Date().toISOString(),file=String(body.file||'archivo.xlsx').slice(0,255),meta={...data.meta,[body.type+'File']:file,[body.type+'ImportedAt']:now};
   if(body.type==='wms'){meta.importId=body.requestId;meta.importedAt=now;meta.wmsCapturedAt=null;meta.seenWmsPositions=[...new Set([...(data.meta.seenWmsPositions||[]),...data.wms.map(r=>r[2]),...body.rows.map(r=>r[2])])];}
   const checkpoint=body.type==='wms'?preserveAutomaticClosures(data,body.rows,now):data;
   next={...data,[body.type]:body.rows,cases:checkpoint.cases,meta,revision:data.revision+1,events:[...checkpoint.events,{id:body.requestId,action:'import',type:body.type,at:now,user:user.email,role:user.role,file,rows:body.rows.length,previous:data[body.type].length}]};
  }else fail_('Operación desconocida.',404);
  if(next!==data)save_(next,data);
  lock.releaseLock();lock=null;
  return json_(pack_({rawState:{...next,events:[]},user,...(input.op==='action'?{receipt:actionReceipt(next,body)}:{})}));
 }catch(err){return json_(errorResponse_(err));}
 finally{if(lock&&lock.hasLock())lock.releaseLock();}
}
function comprobarConfiguracion(){const d=load_(false);console.log(JSON.stringify({sheetId:SHEET_ID,revision:d.revision,octosis:d.octosis.length,products:d.products.length,cross:d.cross.length,wms:d.wms.length}));}
