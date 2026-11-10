export const C3_EMAILS = ['amilano@grupo-aftermarket.com','blas@grupo-aftermarket.com','ignacio@grupo-aftermarket.com','etelias@grupo-aftermarket.com','jpajon@grupo-aftermarket.com','mcrespo@tecnologisticaconsultores.com'];
export const DEPOSITS = ['DISTRIMAR B','DISTRIMAR N','ALEMAR B','JUNIMAR B'];
export const octKey = value => String(value??'').toUpperCase().replace(/\s+/g,'');
export const octPositionKey = value => String(value??'').normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ').replace(/\s*\/\s*/g,'/');
export const wmsKey = value => String(value??'').trim().toUpperCase().replace(/\//g,' ').replace(/\s+/g,' ');
export function fingerprint(value) { let hash=2166136261; for(const c of JSON.stringify(value)){ hash ^= c.charCodeAt(0); hash=Math.imul(hash,16777619); } return (hash>>>0).toString(36); }
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
export function reconcile(data) {
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
export const isResolved = row => CLOSED_STATUSES.includes(row.status);
export function requiresReason(row,action){return action!=='note'&&!(action==='accept'&&row.kind==='Coincide'&&row.locationMatches===true);}
export function applyAction(data,{id,action,reason,quantity,message,expectedRevision,expectedCaseVersion,requestId},user,now=new Date().toISOString()){
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

export function actionReceipt(data,payload){
  const event=data.events.find(event=>event.id===payload.requestId);
  if(!event)throw Object.assign(new Error('No se pudo confirmar el registro de la acción. Tu texto se conserva; reintentá el guardado.'),{status:502,code:'UNCONFIRMED_ACTION'});
  return {confirmed:true,requestId:payload.requestId,caseId:payload.id,action:payload.action,revision:data.revision};
}

// Checkpoint only automatic matches that would stop matching in this import.
// Existing manual decisions, C2 work and explicit reopens are never replaced.
export function preserveAutomaticClosures(data,incomingWms,now=new Date().toISOString()){
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
