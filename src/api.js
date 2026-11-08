import {reconcile,applyAction} from './domain.js';

import {demoData} from './demo.js';
import {restoreSession,saveSession,clearSession} from './session.js';

let config,local,token='',role='C-Administrativo',pending;const storageKey='escobar-review-v1';

async function localDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('escobar-control-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}

async function readLocal(){const db=await localDb();return new Promise((resolve,reject)=>{const tx=db.transaction('data','readonly'),r=tx.objectStore('data').get('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}

async function saveLocal(next){const db=await localDb();return new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put(next,'state');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}

export const setToken=v=>{token=v;};

export const setRole=v=>{role=v;};
export const hasSession=()=>!!token;
export async function signIn(credential){const session=await request('/session',{},'POST',credential);token=session.token;try{saveSession(localStorage,session);}catch{}return session.user;}
function forgetSession(){token='';try{clearSession(localStorage);}catch{}}
export async function signOut(){try{await request('/logout',{});}finally{forgetSession();}}

export async function init(){

 try{const r=await fetch('/api/config');if(!r.ok||!r.headers.get('content-type')?.includes('application/json'))throw Error();config=await r.json();}

 catch{if(import.meta.env.MODE==='vercel')throw new Error('No se pudo conectar con el servidor. Reintentá en unos segundos.');config={mode:'preview',manualWms:true};const r=await fetch('/seed.json');local=r.ok?await r.json():demoData();const saved=await readLocal();if(saved)local=saved;}

 if(config.mode==='sheets'){try{const session=restoreSession(localStorage);if(session)token=session.token;}catch{}}
 return config;

}

async function request(path,body,method,credential){const headers={'x-demo-role':role};if(credential||token)headers.Authorization='Bearer '+(credential||token);if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';const r=await fetch('/api'+path,{method:method||(body?'POST':'GET'),headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});let result=await r.json();if(!r.ok){if(r.status===401&&!credential){forgetSession();if(typeof window!=='undefined')window.dispatchEvent(new Event('inventory-session-expired'));}throw new Error(result.error||'Error de conexión.');}if(result.packed)result=await unpack(result.packed);return result.rawState?{...reconcile(result.rawState),user:result.user,wmsSync:result.wmsSync}:result;}
export async function requestWms(){return request('/wms/request',{});}
export async function pairWms(){return request('/wms/pair',{});}

async function pack(value){const stream=new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));const bytes=new Uint8Array(await new Response(stream).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return {packed:btoa(text)};}

async function unpack(value){const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());}

function view(){return {...reconcile(local),user:{email:'prueba@local.invalid',role}};}

export async function state(revision){return config.mode==='preview'?view():request('/state'+(revision===undefined?'':'?revision='+revision));}

export async function action(body){if(config.mode!=='preview')return request('/action',body);const next=applyAction(local,body,{email:'prueba@local.invalid',role});await saveLocal(next);local=next;return view();}

export async function history(id){return config.mode==='preview'?{events:local.events.filter(e=>!id||e.caseId===id).slice().reverse()}:request('/history'+(id?'?id='+encodeURIComponent(id):''));}

export async function previewImport(type,file){if(config.backend==='apps-script'){if(file.size>25*1024*1024)throw new Error('El límite por archivo es 25 MB.');const {parseWorkbook}=await import('../server/imports.js');const parsed=await parseWorkbook(await file.arrayBuffer(),type);const result=await request('/import/preview',await pack({type,rows:parsed.rows,file:file.name}));pending={id:result.id,type,rows:parsed.rows,file:file.name,expectedRevision:result.revision,requestId:crypto.randomUUID()};return {...result,warnings:parsed.warnings.slice(0,30)};}if(config.mode==='preview'){if(file.size>25*1024*1024)throw new Error('El límite por archivo es 25 MB.');const {parseWorkbook}=await import('../server/imports.js');const parsed=await parseWorkbook(await file.arrayBuffer(),type);pending={...parsed,id:crypto.randomUUID(),type,file:file.name,revision:local.revision};return {id:pending.id,rows:parsed.rows.length,previous:local[type].length,warnings:parsed.warnings.slice(0,30),file:file.name};}const form=new FormData();form.append('type',type);form.append('file',file);return request('/import/preview',form);}

export async function commitImport(id){if(config.backend==='apps-script'){if(!pending||pending.id!==id)throw new Error('Validá el archivo nuevamente.');const result=await request('/import/commit',await pack(pending));pending=null;return result;}if(config.mode!=='preview')return request('/import/commit',{id});if(!pending||pending.id!==id||pending.revision!==local.revision)throw new Error('Los datos cambiaron. Validá el archivo nuevamente.');const p=pending,now=new Date().toISOString(),eventId=crypto.randomUUID(),meta={...local.meta,[p.type+'File']:p.file,[p.type+'ImportedAt']:now};if(p.type==='wms'){meta.importId=eventId;meta.importedAt=now;meta.wmsCapturedAt=null;meta.seenWmsPositions=[...new Set([...(local.meta.seenWmsPositions??[]),...local.wms.map(r=>r[2]),...p.rows.map(r=>r[2])])];}const next={...local,[p.type]:p.rows,meta,revision:local.revision+1,events:[...local.events,{id:eventId,action:'import',type:p.type,at:now,user:'prueba@local.invalid',role,file:p.file,rows:p.rows.length,previous:local[p.type].length}]};await saveLocal(next);local=next;pending=null;return view();}

export function csvDownload(name,rows){const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';const blob=new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
