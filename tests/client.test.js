import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import ExcelJS from 'exceljs';
import * as api from '../src/api.js';

test('cliente interpreta stock e historial comprimidos enviados por Apps Script',async()=>{
 const previous=global.fetch;
 const data={cross:[],products:[['SKU','Articulo',1]],octosis:[],wms:[['SKU',5,'A 001 01','','',5,'Articulo']],cases:{},events:[],meta:{},revision:7};
 const user={email:'operario@example.com',role:'C-Administrativo'};
 const packed=value=>new Response(JSON.stringify({packed:gzipSync(JSON.stringify(value)).toString('base64')}),{headers:{'Content-Type':'application/json'}});
 try{
  global.fetch=async path=>path==='/api/config'?new Response(JSON.stringify({mode:'sheets',backend:'apps-script'}),{headers:{'Content-Type':'application/json'}}):path.startsWith('/api/history')?packed({events:[{id:'evento'}]}):packed({rawState:data,user});
  await api.init();
  const state=await api.state();assert.equal(state.rows[0].wmsQty,5);assert.equal(state.revision,7);assert.equal(state.user.email,user.email);
  assert.equal((await api.history()).events[0].id,'evento');
 }finally{global.fetch=previous;}
});

test('importación Vercel comprime filas y conserva revisión e identificador entre vista previa y confirmación',async()=>{
 const previous=global.fetch;let preview,commit;
 try{
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Cross');
  sheet.addRow(['WMS','OCTOSIS']);sheet.addRow(['A 001 01','A00101']);
  const file=new File([await workbook.xlsx.writeBuffer()],'cross.xlsx');
  global.fetch=async(path,options)=>{
   if(path==='/api/config')return new Response(JSON.stringify({mode:'sheets',backend:'apps-script'}),{headers:{'Content-Type':'application/json'}});
   const body=JSON.parse(gunzipSync(Buffer.from(JSON.parse(options.body).packed,'base64')).toString());
   if(path==='/api/import/preview'){preview=body;return new Response(JSON.stringify({id:'preview',revision:9,rows:1,previous:0,warnings:[]}));}
   commit=body;return new Response(JSON.stringify({revision:10}));
  };
  await api.init();const result=await api.previewImport('cross',file);await api.commitImport(result.id);
  assert.equal(preview.type,'cross');assert.deepEqual(commit.rows,preview.rows);assert.equal(commit.expectedRevision,9);assert.ok(commit.requestId);
 }finally{global.fetch=previous;}
});
