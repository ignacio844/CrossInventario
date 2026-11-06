import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import handler from '../api/index.js';
function response(){return {code:0,body:null,setHeader(){},status(v){this.code=v;return this;},json(v){this.body=v;return this;}};}
test('gateway exige configuración y sesión, y conserva conflictos del backend',async()=>{
 const previous=process.env.APPS_SCRIPT_URL,fetchBefore=global.fetch;
 try{
  delete process.env.APPS_SCRIPT_URL;let r=response();await handler({url:'/api?route=state',headers:{},method:'GET'},r);assert.equal(r.code,503);
  process.env.APPS_SCRIPT_URL='https://script.google.com/macros/s/test-id/exec';r=response();await handler({url:'/api?route=state',headers:{},method:'GET'},r);assert.equal(r.code,401);
  global.fetch=async(url,options)=>{const data=JSON.parse(options.body);assert.equal(data.op,'action');assert.equal(data.token,'verified-by-backend');assert.equal(data.body.expectedRevision,3);return {ok:true,text:async()=>JSON.stringify({status:409,error:'Conflicto'})};};
  r=response();await handler({url:'/api?route=action',headers:{authorization:'Bearer verified-by-backend'},method:'POST',body:{expectedRevision:3}},r);assert.equal(r.code,409);
 }finally{global.fetch=fetchBefore;if(previous===undefined)delete process.env.APPS_SCRIPT_URL;else process.env.APPS_SCRIPT_URL=previous;}
});
test('Apps Script generado valida roles y rechaza sesión antes de acceder a Sheets',()=>{
 const context=vm.createContext({ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({value,setMimeType(){return this;}})}});
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 assert.throws(()=>vm.runInContext("validate_('cross',[['A','B']],{role:'C-Administrativo'})",context),/Solo C3/);
 assert.throws(()=>vm.runInContext("validate_('products',[['A','Articulo',0]],{role:'C3'})",context),/positivo/);
 const result=vm.runInContext("doPost({postData:{contents:JSON.stringify({op:'state',token:''})}})",context);
 assert.equal(JSON.parse(result.value).status,401);
});
