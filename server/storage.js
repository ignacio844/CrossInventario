import fs from 'node:fs/promises';
import path from 'node:path';
import {demoData} from '../src/demo.js';
const tabs={octosis:'Octosis',products:'Productos',cross:'Cross',wms:'WMS',cases:'Casos',events:'Historial',meta:'Control'};
export async function createStorage(mode){
 if(mode==='demo'){
   const file=path.resolve('data/runtime.json');await fs.mkdir(path.dirname(file),{recursive:true});let current;
   try{current=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;try{current=JSON.parse(await fs.readFile('public/seed.json','utf8'));}catch{current=demoData();}}
   return {load:async()=>current,save:async(next)=>{await fs.writeFile(file+'.tmp',JSON.stringify(next));await fs.rename(file+'.tmp',file);current=next;}};
 }
 if(mode!=='sheets'||!process.env.GOOGLE_SHEET_ID||!process.env.GOOGLE_CLIENT_ID)throw new Error('Configuración incompleta: DATA_MODE, GOOGLE_SHEET_ID y GOOGLE_CLIENT_ID.');
 const {google}=await import('googleapis');
 const auth=new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets']});
 const api=google.sheets({version:'v4',auth});const spreadsheetId=process.env.GOOGLE_SHEET_ID;
 let info=(await api.spreadsheets.get({spreadsheetId,fields:'sheets.properties'})).data;
 const missing=Object.values(tabs).filter(t=>!info.sheets.some(s=>s.properties.title===t));
 if(missing.length){await api.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:missing.map(title=>({addSheet:{properties:{title,gridProperties:{rowCount:35000,columnCount:10}}}}))}});info=(await api.spreadsheets.get({spreadsheetId,fields:'sheets.properties'})).data;}
 const ids=Object.fromEntries(info.sheets.map(s=>[s.properties.title,s.properties.sheetId]));
 async function load(){
   const ends={octosis:'D',products:'D',cross:'B',wms:'G',cases:'B',events:'B',meta:'B'};
   const res=await api.spreadsheets.values.batchGet({spreadsheetId,ranges:Object.entries(tabs).map(([k,t])=>`'${t}'!A:${ends[k]}`),valueRenderOption:'UNFORMATTED_VALUE'});
   const all=Object.fromEntries(Object.keys(tabs).map((k,i)=>[k,res.data.valueRanges[i].values??[]]));
   const control=all.meta,newFormat=control[0]?.[0]==='v2';
   const state={octosis:all.octosis,products:all.products,cross:all.cross,wms:all.wms,cases:Object.fromEntries(all.cases.map(r=>[r[0],JSON.parse(r[1])])),events:all.events.map(r=>JSON.parse(r[1])),meta:newFormat?JSON.parse(control.slice(1).map(r=>r[0]??'').join('')):control[0]?JSON.parse(control[0][0]):{},revision:newFormat?Number(control[0][1]):control[1]?Number(control[1][0]):0};return state;
 }
 return {load,save:async(next,previous)=>{
   // Un único servidor procesa todas las escrituras. Un batch aplica datos y auditoría juntos.
   const requests=[];
   for(const k of Object.keys(tabs)){
     if(previous&&next[k]===previous[k]&&k!=='meta')continue;
     const metaJson=JSON.stringify(next.meta),controlRows=[['v2',next.revision],...(metaJson.match(/[\s\S]{1,35000}/g)??['{}']).map(chunk=>[chunk])];
     const rows=k==='cases'?Object.entries(next.cases).map(([id,v])=>[id,JSON.stringify(v)]):k==='events'?next.events.map(e=>[e.id,JSON.stringify(e)]):k==='meta'?controlRows:next[k];
     const oldCount=k==='cases'?Object.keys(previous?.cases??{}).length:k==='events'?(previous?.events??[]).length:k==='meta'?Math.max(2,1+Math.ceil(JSON.stringify(previous?.meta??{}).length/35000)):(previous?.[k]??[]).length;
     const rowCount=Math.max(rows.length,oldCount,1);
     requests.push({updateSheetProperties:{properties:{sheetId:ids[tabs[k]],gridProperties:{rowCount:Math.max(rowCount,35000),columnCount:10}},fields:'gridProperties.rowCount,gridProperties.columnCount'}});
     requests.push({updateCells:{range:{sheetId:ids[tabs[k]],startRowIndex:0,endRowIndex:rowCount,startColumnIndex:0,endColumnIndex:10},rows:rows.map(r=>({values:r.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}}))})),fields:'userEnteredValue'}});
   }
   await api.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests}});
 }};
}
