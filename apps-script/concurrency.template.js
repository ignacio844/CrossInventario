function busy_(){const error=new Error('Hay otros guardados en curso. La app reintentará sin cerrar tu sesión.');error.status=429;error.code='BUSY';throw error;}
function parseControl_(rows){return {controlV2:rows[0]?.[0]==='v2',meta:rows[0]?.[0]==='v2'?JSON.parse(rows.slice(1).map(row=>row[0]||'').join('')):JSON.parse(rows[0]?.[0]||'{}'),revision:rows[0]?.[0]==='v2'?Number(rows[0][1]):Number(rows[1]?.[0]||0)};}
function readControl_(){return parseControl_(Sheets.Spreadsheets.Values.get(SHEET_ID,"'Control'!A:B",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[]);}
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
 const keys=['octosis','products','cross','wms'],ends={octosis:'D',products:'D',cross:'B',wms:'G'};
 const result=Sheets.Spreadsheets.Values.batchGet(SHEET_ID,{ranges:[...keys.map(key=>"'"+TABLES[key]+"'!A:"+ends[key]),"'Control'!A:B"],valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
 if(sourceStamp_(parseControl_(result[4].values||[]).meta)!==stamp)busy_();
 const sources=Object.fromEntries(keys.map((key,index)=>[key,result[index].values||[]]));cacheSources_(key,sources);return sources;
}
function loadReview_(withRequestIds){
 const result=Sheets.Spreadsheets.Values.batchGet(SHEET_ID,{ranges:["'Casos'!A:B","'Control'!A:B",...(withRequestIds?["'Historial'!A:A"]:[])],valueRenderOption:'UNFORMATTED_VALUE'}).valueRanges;
 return {...parseControl_(result[1].values||[]),cases:Object.fromEntries((result[0].values||[]).filter(row=>row[0]).map(row=>[row[0],JSON.parse(row[1])])),events:withRequestIds?(result[2].values||[]).map(row=>({id:row[0],requestId:row[0]})):[]};
}
function loadSnapshot_(){
 // Stock sources are immutable between imports and cached separately from cases.
 // Readers never take the writer lock. A fresh revision check rejects mixed reads.
 for(let attempt=0;attempt<2;attempt++){
  const control=readControl_(),sources=loadSources_(control),review=loadReview_(false);
  if(control.revision===review.revision&&review.revision===revision_(true)&&sourceStamp_(control.meta)===sourceStamp_(review.meta))return {...sources,...review};
 }
 busy_();
}
function loadHistory_(id){
 const rows=Sheets.Spreadsheets.Values.get(SHEET_ID,"'Historial'!B:B",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
 return {events:rows.filter(row=>row[0]).map(row=>JSON.parse(row[0])).filter(event=>!id||event.caseId===id).reverse()};
}
