export const C3_EMAILS = ['amilano@grupo-aftermarket.com','blas@grupo-aftermarket.com','ignacio@grupo-aftermarket.com','etelias@grupo-aftermarket.com','jpajon@grupo-aftermarket.com','mcrespo@tecnologisticaconsultores.com'];
export const DEPOSITS = ['DISTRIMAR B','ALEMAR B','JUNIMAR B'];
export const octKey = value => String(value??'').toUpperCase().replace(/\s+/g,'');
export const wmsKey = value => String(value??'').trim().toUpperCase().replace(/\//g,' ').replace(/\s+/g,' ');
export function fingerprint(value) { let hash=2166136261; for(const c of JSON.stringify(value)){ hash ^= c.charCodeAt(0); hash=Math.imul(hash,16777619); } return (hash>>>0).toString(36); }
export function reconcile(data) {
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
    r.autoResolved=r.kind==='Coincide'&&r.locationMatches===true;
    if(r.autoResolved)r.status='Resuelto automáticamente';
    return r;
  });
  rows.sort((a,b)=>Number(b.active)-Number(a.active)||a.positions[0].localeCompare(b.positions[0],undefined,{numeric:true})||a.sku.localeCompare(b.sku));
  return {rows,stats:{activeGroups:active.size,records:rows.filter(r=>r.active).length,missingUnits:rows.filter(r=>r.saleUnit==null).length,unmapped:rows.filter(r=>!r.mapped).length,ambiguousOld:[...oldLinks.values()].filter(s=>s.size>1).length},revision:data.revision,meta:data.meta};
}
export const isResolved = row => ['Aceptado C3','Verificado C3','Resuelto automáticamente'].includes(row.status);
export function requiresReason(row,action){return !(action==='accept'&&row.kind==='Coincide'&&row.locationMatches===true);}
export function applyAction(data,{id,action,reason,quantity,expectedRevision,requestId},user,now=new Date().toISOString()){
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
