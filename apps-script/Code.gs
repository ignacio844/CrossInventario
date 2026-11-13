// Generado por npm run build:apps-script. No pegar secretos aquí.
const C3_EMAILS = ['amilano@grupo-aftermarket.com','blas@grupo-aftermarket.com','ignacio@grupo-aftermarket.com','etelias@grupo-aftermarket.com','jpajon@grupo-aftermarket.com','mcrespo@tecnologisticaconsultores.com'];
const DEPOSITS = ['DISTRIMAR B','DISTRIMAR N','ALEMAR B','JUNIMAR B'];
const octKey = value => String(value??'').toUpperCase().replace(/\s+/g,'');
const octPositionKey = value => String(value??'').normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ').replace(/\s*\/\s*/g,'/');
const wmsKey = value => String(value??'').trim().toUpperCase().replace(/\//g,' ').replace(/\s+/g,' ');
function fingerprint(value) { let hash=2166136261; for(const c of JSON.stringify(value)){ hash ^= c.charCodeAt(0); hash=Math.imul(hash,16777619); } return (hash>>>0).toString(36); }
const CLOSED_STATUSES=['Aceptado','Aceptado C3','Verificado','Verificado C3','Resuelto automáticamente'];
const positionSet=values=>[...new Set((values||[]).map(octPositionKey))].sort();
function closureReferenceMatches(row,saved,meta){
  if(!CLOSED_STATUSES.includes(saved?.status))return false;
  if(saved.referenceFingerprint)return saved.referenceFingerprint===row.referenceFingerprint;
  // Older decisions have no reference hash. Restore them only while their
  // reference imports and any saved Octosis quantities/positions still agree.
  const at=Date.parse(saved.updatedAt);if(!Number.isFinite(at))return !row.changed;
  if(['octosisImportedAt','crossImportedAt','productsImportedAt'].some(key=>Date.parse(meta[key])>at))return false;
  const snapshot=saved.snapshot;
  if(snapshot&&(snapshot.oldQty!==row.oldQty||JSON.stringify(positionSet(snapshot.originalPositions))!==JSON.stringify(positionSet(row.oldDetails.map(detail=>detail.position)))))return false;
  return true;
}
function reconcile(data) {
  const parent=new Map();
  function root(x){ if(!parent.has(x))parent.set(x,x); if(parent.get(x)!==x)parent.set(x,root(parent.get(x))); return parent.get(x); }
  function union(a,b){a=root(a);b=root(b);if(a!==b)parent.set(a<b?b:a,a<b?a:b);}
  const links=data.cross.map(([w,o])=>({wk:wmsKey(w),ok:octPositionKey(o),label:String(o??'').trim()})).filter(link=>link.wk&&link.ok);
  const forms=new Map();
  for(const link of links){const compact=octKey(link.ok);if(!forms.has(compact))forms.set(compact,new Set());forms.get(compact).add(link.ok);}
  const oldLinks=new Map(),oldNodes=new Map(),reverseLinks=new Map();
  for(const {wk,ok,label} of links){
    // Keep existing case IDs for unambiguous cross entries; joins use the spaced key.
    const node='o:'+(forms.get(octKey(ok)).size===1?octKey(ok):'exact:'+ok);
    oldNodes.set(ok,node);union('w:'+wk,node);
    if(!oldLinks.has(ok))oldLinks.set(ok,new Set());oldLinks.get(ok).add(wk);
    if(!reverseLinks.has(wk))reverseLinks.set(wk,new Map());reverseLinks.get(wk).set(ok,label);
  }
  const groups=new Map();
  for(const node of parent.keys()){const id=root(node);if(!groups.has(id))groups.set(id,{old:[],positions:[]});groups.get(id)[node.startsWith('o:')?'old':'positions'].push(node.slice(2));}
  for(const g of groups.values()){g.old.sort();g.positions.sort();}
  const catalog=new Map(data.products.map(p=>[p[0],p]));const map=new Map();
  const make=(group,sku)=>{const id=JSON.stringify([group,sku]);if(!map.has(id))map.set(id,{id,group,sku,description:catalog.get(sku)?.[1]||'',saleUnit:catalog.get(sku)?.[2]??null,barcode:String(catalog.get(sku)?.[3]??''),oldQty:0,wmsQty:0,oldPresent:false,wmsPresent:false,oldDetails:[],wmsDetails:[],positions:groups.get(group)?.positions??[group.slice(2)],oldPositions:groups.get(group)?.old??[],mapped:groups.has(group)});return map.get(id);};
  for(const [sku,q,pos,dep] of data.octosis){if(!DEPOSITS.includes(dep))continue; const ok=octPositionKey(pos);const group=oldNodes.has(ok)?root(oldNodes.get(ok)):'o:unmapped:'+ok;const r=make(group,sku);r.oldPresent=true;r.oldQty+=q;r.oldDetails.push({position:pos,deposit:dep,quantity:q});}
  const active=new Set();
  for(const [sku,q,pos,depth,container,bultos,description] of data.wms){const wk=wmsKey(pos),group=parent.has('w:'+wk)?root('w:'+wk):'w:'+wk;active.add(group);const r=make(group,sku);r.wmsPresent=true;r.wmsQty+=q;if(!r.description)r.description=description;r.wmsDetails.push({position:wk,depth,container,quantity:q,bultos});}
  for(const pos of data.meta.seenWmsPositions??[]){const wk=wmsKey(pos);active.add(parent.has('w:'+wk)?root('w:'+wk):'w:'+wk);}
  // Retain reviewed cases even when a correction removes their last stock row.
  // Their source quantities remain absent; no stock or locations are fabricated.
  for(const id of Object.keys(data.cases))if(!map.has(id)){
    try{const [group,sku]=JSON.parse(id);if(typeof group!=='string'||typeof sku!=='string'||JSON.stringify([group,sku])!==id)continue;const row=make(group,sku);row.historicalOnly=true;if(!groups.has(group)){row.positions=[];row.oldPositions=[];}}
    catch(error){/* Ignore malformed legacy IDs, preserving their audit records. */}
  }
  const rows=[...map.values()].map(r=>{
    const group=groups.get(r.group);r.active=active.has(r.group);r.delta=r.wmsQty-r.oldQty;
    r.kind=!r.oldPresent&&!r.wmsPresent?'No figura en fuentes':!r.oldPresent?'Solo WMS':!r.wmsPresent?'Solo Octosis':r.delta!==0?'Cantidad distinta':'Coincide';
    r.multiple=!!group&&group.positions.length>1;
    r.crossOriginalLocations=[...new Set(r.wmsDetails.flatMap(d=>[...(reverseLinks.get(wmsKey(d.position))?.values()||[])]))].sort();
    if(r.historicalOnly&&r.mapped&&!r.crossOriginalLocations.length)r.crossOriginalLocations=[...new Set(links.filter(link=>root(oldNodes.get(link.ok))===r.group).map(link=>link.label))].sort();
    r.expectedPositions=[...new Set(r.oldDetails.flatMap(d=>[...(oldLinks.get(octPositionKey(d.position))||[])]))].sort();
    r.locationMatches=!r.wmsPresent?null:!r.mapped?false:r.oldPresent?r.wmsDetails.every(d=>r.expectedPositions.includes(wmsKey(d.position))):r.wmsDetails.every(d=>reverseLinks.has(wmsKey(d.position)));
    r.fingerprint=fingerprint([r.oldDetails.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),r.wmsDetails.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),r.positions,r.oldPositions,r.saleUnit]);
    r.referenceFingerprint=fingerprint([r.oldDetails.slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),groups.get(r.group)?.positions??[r.group.slice(2)],r.oldPositions,r.saleUnit]);
    const saved=data.cases[r.id];r.review=saved??{};r.caseVersion=JSON.stringify([r.fingerprint,saved?.decisionRevision||0,saved?.status||null,saved?.fingerprint||null,saved?.updatedAt||null,saved?.updatedBy||null]);r.changed=!!saved?.fingerprint&&saved.fingerprint!==r.fingerprint;
    r.closurePreserved=r.changed&&closureReferenceMatches(r,saved,data.meta);
    // A new WMS destination is a location change, not merely a quantity change.
    if(r.closurePreserved&&saved.snapshot?.wmsPositions&&r.wmsDetails.some(detail=>!saved.snapshot.wmsPositions.map(wmsKey).includes(wmsKey(detail.position))))r.closurePreserved=false;
    r.reviewedDelta=Number.isFinite(saved?.snapshot?.wmsQty)&&Number.isFinite(saved?.snapshot?.oldQty)?saved.snapshot.wmsQty-saved.snapshot.oldQty:(!r.changed?r.delta:null);
    r.postReviewDelta=r.closurePreserved&&r.wmsPresent&&Number.isFinite(saved?.snapshot?.wmsQty)?r.wmsQty-saved.snapshot.wmsQty:null;
    r.status=r.changed&&!r.closurePreserved?'Revisar cambio':saved?.status??(r.active?'Pendiente':'Sin carga WMS');
    if(saved?.status==='Ajustado en WMS'&&r.changed)r.status='Verificar ajuste';
    const pendingAdjustment=saved?.status==='Ajustado en WMS'&&(r.wmsQty!==saved.targetQuantity||data.meta.importId===saved.adjustmentImportId||data.meta.wmsCapturedAt&&Date.parse(data.meta.wmsCapturedAt)<=Date.parse(saved.adjustmentAt||saved.updatedAt));
    r.autoResolved=r.kind==='Coincide'&&r.locationMatches===true&&!pendingAdjustment&&!CLOSED_STATUSES.includes(saved?.status)&&saved?.lastAction!=='reopen';
    if(r.autoResolved)r.status='Resuelto automáticamente';
    return r;
  });
  const loadedBySku=new Map();
  for(const row of rows)if(row.wmsPresent){if(!loadedBySku.has(row.sku))loadedBySku.set(row.sku,[]);loadedBySku.get(row.sku).push(row);}
  for(const row of rows)row.otherWms=(loadedBySku.get(row.sku)||[]).filter(other=>other.id!==row.id).map(other=>({id:other.id,quantity:other.wmsQty,positions:[...new Set(other.wmsDetails.map(detail=>detail.position))]}));
  rows.sort((a,b)=>Number(b.active)-Number(a.active)||(a.positions[0]||'').localeCompare(b.positions[0]||'',undefined,{numeric:true})||a.sku.localeCompare(b.sku));
  return {rows,stats:{activeGroups:active.size,records:rows.filter(r=>r.active).length,missingUnits:rows.filter(r=>r.saleUnit==null).length,unmapped:rows.filter(r=>!r.mapped).length,ambiguousOld:[...oldLinks.values()].filter(s=>s.size>1).length},revision:data.revision,meta:data.meta};
}
const isResolved = row => CLOSED_STATUSES.includes(row.status);
function requiresReason(row,action){return action!=='note'&&!(action==='accept'&&row.kind==='Coincide'&&row.locationMatches===true);}
function applyAction(data,{id,action,reason,quantity,message,expectedRevision,expectedCaseVersion,requestId},user,now=new Date().toISOString()){
  if(!user?.email)throw new Error('Iniciá sesión para guardar.');
  if(requestId&&data.events.some(e=>e.requestId===requestId))return data;
  const row=reconcile(data).rows.find(r=>r.id===id);if(!row)throw new Error('No se encontró el caso. Recargá la vista.');
  if(typeof expectedCaseVersion==='string'){
    if(action!=='note'&&expectedCaseVersion!==row.caseVersion)throw Object.assign(new Error('Este caso cambió mientras lo revisabas. Actualizá los datos y revisalos antes de guardar. Tu texto se conserva.'),{status:409,code:'CASE_CHANGED'});
  }else if(expectedRevision!==data.revision)throw Object.assign(new Error('Otro usuario actualizó los datos. Recargá y revisá antes de guardar.'),{status:409,code:'REVISION_CHANGED'});
  if(action==='note'){
    const text=String(message??'').trim();
    if(!text)return data;
    if(text.length>2000)throw new Error('El mensaje admite hasta 2.000 caracteres.');
    const eventId=requestId||crypto.randomUUID(),note={id:eventId,text,at:now,by:user.email,role:user.role};
    const previous=data.cases[id]??{},next={...previous,note,noteCount:(previous.noteCount||0)+1};
    const event={id:eventId,requestId,caseId:id,sku:row.sku,action,at:now,user:user.email,role:user.role,note,source:data.meta.wmsFile,importId:data.meta.importId};
    return {...data,revision:data.revision+1,cases:{...data.cases,[id]:next},events:[...data.events,event]};
  }
  if(!row.active)throw new Error('El caso no tiene carga WMS registrada.');
  reason=String(reason??'').trim();
  if(requiresReason(row,action)&&!reason)throw new Error('Escribí un motivo o una observación.');
  if(reason.length>2000)throw new Error('La observación admite hasta 2.000 caracteres.');
  const actions={'request-c2':'Solicitado C2','record-c2':'C2 registrado','accept':'Aceptado','adjust':'Ajustado en WMS','verify':'Verificado','reopen':'Pendiente'};
  if(!actions[action])throw new Error('Acción desconocida.');
  if(['record-c2','adjust'].includes(action)&&(!Number.isFinite(quantity)||quantity<0))throw new Error('Indicá una cantidad válida, mayor o igual a cero.');
  if(action==='record-c2'&&row.review.status!=='Solicitado C2')throw new Error('Solicitá C2 antes de registrar su resultado.');
  if(action==='verify'){
    if(row.review.status!=='Ajustado en WMS'||data.meta.importId===row.review.adjustmentImportId)throw new Error('Importá una descarga posterior al ajuste para verificarlo.');
    if(data.meta.wmsCapturedAt&&Date.parse(data.meta.wmsCapturedAt)<=Date.parse(row.review.adjustmentAt||row.review.updatedAt))throw new Error('La descarga se tomó antes del ajuste. Esperá una captura posterior para verificarlo.');
    if(row.wmsQty!==row.review.targetQuantity)throw new Error('WMS todavía no coincide con la cantidad ajustada registrada.');
  }
  const previous=data.cases[id]??null;
  const eventId=requestId||crypto.randomUUID();
  const next={...previous,status:actions[action],decisionRevision:(previous?.decisionRevision||0)+1,reason:reason.trim(),updatedAt:now,updatedBy:user.email,fingerprint:row.fingerprint,referenceFingerprint:row.referenceFingerprint,lastAction:action,lastRequestId:eventId,snapshot:{importId:data.meta.importId,wmsFile:data.meta.wmsFile,wmsCapturedAt:data.meta.wmsCapturedAt||data.meta.importedAt,wmsQty:row.wmsQty,oldQty:row.oldQty,wmsPresent:row.wmsPresent,wmsPositions:row.wmsDetails.map(detail=>detail.position),originalPositions:row.oldDetails.map(detail=>detail.position)}};
  if(action==='record-c2')next.c2={quantity,by:user.email,at:now,note:reason.trim()};
  if(action==='adjust'){next.targetQuantity=quantity;next.adjustmentImportId=data.meta.importId;next.adjustmentAt=now;}
  const event={id:eventId,requestId,caseId:id,sku:row.sku,action,at:now,user:user.email,role:user.role,before:previous,after:next,wmsQty:row.wmsQty,oldQty:row.oldQty,source:data.meta.wmsFile,importId:data.meta.importId};
  return {...data,revision:data.revision+1,cases:{...data.cases,[id]:next},events:[...data.events,event]};
}

function actionReceipt(data,payload){
  const event=data.events.find(event=>event.id===payload.requestId);
  if(!event)throw Object.assign(new Error('No se pudo confirmar el registro de la acción. Tu texto se conserva; reintentá el guardado.'),{status:502,code:'UNCONFIRMED_ACTION'});
  return {confirmed:true,requestId:payload.requestId,caseId:payload.id,action:payload.action,revision:data.revision};
}

// Checkpoint only automatic matches that would stop matching in this import.
// Existing manual decisions, C2 work and explicit reopens are never replaced.
function preserveAutomaticClosures(data,incomingWms,now=new Date().toISOString()){
  const after=new Map(reconcile({...data,wms:incomingWms}).rows.map(row=>[row.id,row]));
  const candidates=reconcile(data).rows.filter(row=>row.autoResolved&&!row.review.status&&!after.get(row.id)?.autoResolved);
  if(!candidates.length)return data;
  const cases={...data.cases},events=[...data.events];
  for(const row of candidates){
    const id='auto:'+row.id+':'+String(data.meta.importId||row.fingerprint);
    const saved={...row.review,status:'Resuelto automáticamente',decisionRevision:(row.review.decisionRevision||0)+1,reason:'Cantidad y ubicación coincidían antes de esta actualización WMS.',updatedAt:now,updatedBy:'Sistema',fingerprint:row.fingerprint,referenceFingerprint:row.referenceFingerprint,lastAction:'auto-resolve',lastRequestId:id,snapshot:{importId:data.meta.importId,wmsFile:data.meta.wmsFile,wmsCapturedAt:data.meta.wmsCapturedAt||data.meta.importedAt,wmsQty:row.wmsQty,oldQty:row.oldQty,wmsPresent:row.wmsPresent,wmsPositions:row.wmsDetails.map(detail=>detail.position),originalPositions:row.oldDetails.map(detail=>detail.position)}};
    cases[row.id]=saved;events.push({id,caseId:row.id,sku:row.sku,action:'auto-resolve',at:now,user:'Sistema',role:'Automático',after:saved,wmsQty:row.wmsQty,oldQty:row.oldQty,source:data.meta.wmsFile,importId:data.meta.importId});
  }
  return {...data,cases,events};
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

function busy_(){const error=new Error('Hay otros guardados en curso. La app reintentará sin cerrar tu sesión.');error.status=429;error.code='BUSY';throw error;}
function parseControl_(rows){return {controlV2:rows[0]?.[0]==='v2',meta:rows[0]?.[0]==='v2'?JSON.parse(rows.slice(1).map(row=>row[0]||'').join('')):JSON.parse(rows[0]?.[0]||'{}'),revision:rows[0]?.[0]==='v2'?Number(rows[0][1]):Number(rows[1]?.[0]||0)};}
function readControl_(){quotaGuard_();return parseControl_(Sheets.Spreadsheets.Values.get(SHEET_ID,"'Control'!A:B",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[]);}
function sourceStamp_(meta){return sessionKey_(JSON.stringify([meta.importId,meta.octosisImportedAt,meta.productsImportedAt,meta.crossImportedAt,meta.octosisFile,meta.productsFile,meta.crossFile]));}
function cachedSources_(key){
 try{
  const cache=CacheService.getScriptCache(),count=Number(cache.get(key));if(!count||count>100)return null;
  const keys=Array.from({length:count},(_,index)=>key+':'+index),parts=cache.getAll(keys);
  if(keys.some(part=>typeof parts[part]!=='string'))return null;
  return unpack_({packed:keys.map(part=>parts[part]).join('')});
 }catch(error){return null;}
}
function cacheSources_(key,sources){
 try{
  const parts=pack_(sources).packed.match(/[\s\S]{1,90000}/g)||[];if(!parts.length||parts.length>100)return;
  const cache=CacheService.getScriptCache();cache.putAll(Object.fromEntries(parts.map((part,index)=>[key+':'+index,part])),300);cache.put(key,String(parts.length),300);
 }catch(error){/* The cache is optional; Sheets remains the source of truth. */}
}
function loadSources_(control){
 const stamp=sourceStamp_(control.meta),key='sources-v1:'+stamp,cached=cachedSources_(key);if(cached)return cached;
 quotaGuard_();
 const keys=['octosis','products','cross','wms'],ends={octosis:'D',products:'D',cross:'B',wms:'G'};
 const result=Sheets.Spreadsheets.Values.batchGet(SHEET_ID,{ranges:[...keys.map(key=>"'"+TABLES[key]+"'!A:"+ends[key]),"'Control'!A:B"],valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
 if(sourceStamp_(parseControl_(result[4].values||[]).meta)!==stamp)busy_();
 const sources=Object.fromEntries(keys.map((key,index)=>[key,result[index].values||[]]));cacheSources_(key,sources);return sources;
}
function loadReview_(withRequestIds){
 quotaGuard_();
 const result=Sheets.Spreadsheets.Values.batchGet(SHEET_ID,{ranges:["'Casos'!A:B","'Control'!A:B",...(withRequestIds?["'Historial'!A:A"]:[])],valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
 return {...parseControl_(result[1].values||[]),cases:Object.fromEntries((result[0].values||[]).filter(row=>row[0]).map(row=>[row[0],JSON.parse(row[1])])),events:withRequestIds?(result[2].values||[]).map(row=>({id:row[0],requestId:row[0]})):[]};
}
function loadSnapshot_(fresh=false){
 const warm=cachedReview_(revision_(fresh),false);if(warm)return {...loadSources_(warm),...warm};
 // Stock sources are immutable between imports and cached separately from cases.
 // Readers never take the writer lock. A fresh revision check rejects mixed reads.
 for(let attempt=0;attempt<2;attempt++){
  const control=readControl_(),sources=loadSources_(control),review=loadReview_(false);
  if(control.revision===review.revision&&review.revision===revision_(true)&&sourceStamp_(control.meta)===sourceStamp_(review.meta))return cacheReview_(review,false),{...sources,...review};
 }
 busy_();
}
function loadHistory_(id){
 const key='history-v1:'+revision_(),cached=cachedSources_(key);if(cached)return {events:cached.events.filter(event=>!id||event.caseId===id).reverse()};
 quotaGuard_();
 const rows=Sheets.Spreadsheets.Values.get(SHEET_ID,"'Historial'!B:B",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
 const events=rows.filter(row=>row[0]).map(row=>JSON.parse(row[0]));cacheSources_(key,{events});return {events:events.filter(event=>!id||event.caseId===id).reverse()};
}

function cachedReview_(revision,withRequestIds){const value=cachedSources_('review-v2:'+revision);return value&&value.revision===revision&&(!withRequestIds||value.requestIdsLoaded)?value:null;}
function cacheReview_(data,withRequestIds){
 if(!withRequestIds&&cachedReview_(data.revision,true))return;
 cacheSources_('review-v2:'+data.revision,{cases:data.cases,meta:data.meta,revision:data.revision,controlV2:data.controlV2!==false,events:withRequestIds?data.events.map(event=>({id:event.id,requestId:event.id})):[],requestIdsLoaded:!!withRequestIds});
}
function actionControl_(){return cachedReview_(revision_(),false)||readControl_();}
function actionReview_(){return cachedReview_(revision_(true),true)||loadReview_(true);}
function sheetInfo_(){
 const cache=CacheService.getScriptCache();let cached;try{cached=cache.get('sheet-properties-v1');}catch(error){}
 if(cached)return JSON.parse(cached);
 quotaGuard_();const value=Sheets.Spreadsheets.get(SHEET_ID,{fields:'sheets.properties'});try{cache.put('sheet-properties-v1',JSON.stringify(value),300);}catch(error){}return value;
}
function quotaGuard_(){
 const until=Number(CacheService.getScriptCache().get?.('sheets-quota-until')||0);
 if(until>Date.now()){const error=new Error('Google Sheets alcanzó su límite temporal. Esperá un momento; tu texto se conserva.');error.status=429;error.code='SHEETS_QUOTA';error.retryAfterMs=until-Date.now();throw error;}
}
function errorResponse_(error){
 if(/Quota exceeded|requests per minute|RESOURCE_EXHAUSTED/i.test(error.message||'')){
  CacheService.getScriptCache().put('sheets-quota-until',String(Date.now()+65000),70);
  return {status:429,code:'SHEETS_QUOTA',retryAfterMs:65000,error:'Google Sheets alcanzó su límite temporal. La app esperará antes de reintentar. Tu texto se conserva.'};
 }
 return {status:error.status||400,code:error.code,retryAfterMs:error.retryAfterMs,error:error.message||'No se pudo completar la operación.'};
}

const WMS_PRODUCTION_URL='https://wms.grupo-aftermarket.com:4446/SGLWMS_DISTRIMAR_PROD/hinicio.aspx';
const WMS_SYNC_KEY='wms-sync-v1';
const WMS_INTERVAL_SECONDS=60*60;
function syncRead_(){const value=PropertiesService.getScriptProperties().getProperty(WMS_SYNC_KEY);return {...(value?JSON.parse(value):{enabled:false,job:null}),intervalSeconds:WMS_INTERVAL_SECONDS};}
function syncSave_(value){PropertiesService.getScriptProperties().setProperty(WMS_SYNC_KEY,JSON.stringify(value));CacheService.getScriptCache().remove(WMS_SYNC_KEY);}
function syncPublic_(){
 const cache=CacheService.getScriptCache();let saved=cache.get(WMS_SYNC_KEY);
 if(!saved){const value=syncRead_();saved=JSON.stringify({configured:!!PropertiesService.getScriptProperties().getProperty('wms-worker-hash'),enabled:!!value.enabled,intervalSeconds:WMS_INTERVAL_SECONDS,lastHeartbeatAt:value.lastHeartbeatAt||null,lastSuccessAt:value.lastSuccessAt||null,lastRows:value.lastRows||0,lastError:value.lastError||null,job:value.job?{id:value.job.id,status:value.job.status,stage:value.job.stage,requestedAt:value.job.requestedAt,requestedBy:value.job.requestedBy,trigger:value.job.trigger,startedAt:value.job.startedAt,finishedAt:value.job.finishedAt,error:value.job.error}:null});cache.put(WMS_SYNC_KEY,saved,5);}
 const result=JSON.parse(saved);result.intervalSeconds=WMS_INTERVAL_SECONDS;result.connected=!!result.lastHeartbeatAt&&Date.now()-Date.parse(result.lastHeartbeatAt)<60000;result.productionUrl=WMS_PRODUCTION_URL;return result;
}
function syncLock_(fn){const lock=LockService.getScriptLock();if(!lock.tryLock(20000))fail_('Hay otra operación en curso. Reintentá en unos segundos.',429);try{return fn();}finally{lock.releaseLock();}}
function syncExpire_(sync,now){if(sync.job&&sync.job.status==='running'&&sync.job.leaseUntil<now){sync.job.status='error';sync.job.error='El equipo dejó de responder durante la descarga.';sync.job.finishedAt=new Date(now).toISOString();sync.lastError=sync.job.error;}}
function syncQueue_(sync,trigger,requestedBy){const now=Date.now();syncExpire_(sync,now);if(sync.job&&['pending','running'].includes(sync.job.status))return false;sync.job={id:Utilities.getUuid(),status:'pending',stage:'Pendiente',requestedAt:new Date(now).toISOString(),requestedBy,trigger};sync.lastError=null;return true;}
function syncUser_(op,user){return syncLock_(()=>{
 const properties=PropertiesService.getScriptProperties(),sync=syncRead_();
 if(op==='wms-pair'){
  const code=Utilities.getUuid().replace(/-/g,''),expiresAt=Date.now()+10*60*1000;
  properties.setProperty('wms-pair',JSON.stringify({hash:sessionKey_(code),expiresAt,by:user.email}));
  return {code,expiresAt,productionUrl:WMS_PRODUCTION_URL};
 }
 if(op==='wms-request'){
  if(!properties.getProperty('wms-worker-hash'))fail_('Primero conectá el equipo de descarga.',503);
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
  return {ok:true,intervalSeconds:WMS_INTERVAL_SECONDS,productionUrl:WMS_PRODUCTION_URL};
 }
 if(typeof input.token!=='string'||input.token.length<40||sessionKey_(input.token)!==properties.getProperty('wms-worker-hash'))fail_('Equipo no autorizado.',401);
 const body=unpack_(input.body||{}),sync=syncRead_(),now=Date.now();syncExpire_(sync,now);sync.lastHeartbeatAt=new Date(now).toISOString();
 if(input.op==='worker-poll'){
  if(sync.enabled&&(!sync.lastAttemptAt||now-Date.parse(sync.lastAttemptAt)>=WMS_INTERVAL_SECONDS*1000))syncQueue_(sync,'automatic','Automático WMS');
  if(sync.job&&sync.job.status==='pending'){
   const meta=syncMeta_();sync.job.status='running';sync.job.stage='Descargando stock';sync.job.startedAt=new Date(now).toISOString();sync.job.leaseUntil=now+180000;sync.job.baseImportId=meta.importId||null;sync.lastAttemptAt=sync.job.startedAt;
   syncSave_(sync);return {job:{id:sync.job.id,startedAt:sync.job.startedAt},intervalSeconds:WMS_INTERVAL_SECONDS,productionUrl:WMS_PRODUCTION_URL};
  }
  syncSave_(sync);return {job:null,intervalSeconds:WMS_INTERVAL_SECONDS};
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
  const checkpoint=preserveAutomaticClosures(data,body.rows,at);
  save_({...data,wms:body.rows,cases:checkpoint.cases,meta,revision:data.revision+1,events:[...checkpoint.events,event]},data);
 }
 job.status='done';job.stage='Stock actualizado';job.finishedAt=new Date(now).toISOString();sync.lastSuccessAt=job.finishedAt;sync.lastRows=body.rows.length;sync.lastError=null;syncSave_(sync);
 return {ok:true,rows:body.rows.length,jobId:job.id};
});}
