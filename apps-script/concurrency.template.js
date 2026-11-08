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
function loadSnapshot_(){
 const warm=cachedReview_(revision_(),false);if(warm)return {...loadSources_(warm),...warm};
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
