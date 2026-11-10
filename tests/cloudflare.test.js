import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.js';

const env={APPS_SCRIPT_URL:'https://script.google.com/macros/s/test-id/exec',GOOGLE_CLIENT_ID:'google-client',ASSETS:{fetch:async()=>new Response('app assets')}};
const request=(path,body,token='s1.test-session')=>new Request('https://inventory.example'+path,{method:body?'POST':'GET',headers:token?{Authorization:'Bearer '+token}:undefined,...(body?{body:JSON.stringify(body),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}}:{})});

test('Cloudflare sirve la aplicación y la configuración sin leer inventario ni exponer datos',async()=>{
 assert.equal(await (await worker.fetch(request('/'),env)).text(),'app assets');
 const config=await worker.fetch(request('/api/config'),env);assert.equal(config.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(await config.json(),{mode:'sheets',backend:'apps-script',googleClientId:'google-client',manualWms:false,wmsSync:true,backendConfigured:true});
 assert.equal((await worker.fetch(request('/api/state',null,''),env)).status,401);
 assert.equal((await worker.fetch(request('/api/state'),{...env,APPS_SCRIPT_URL:'https://other.example'})).status,503);
});

test('Cloudflare conserva token, versión, ID idempotente, cuerpo y confirmación del historial',async()=>{
 const original=global.fetch,body={id:'case',requestId:'same-request',expectedCaseVersion:'version',action:'accept',reason:'Revisado'};
 const receipt={confirmed:true,requestId:body.requestId,caseId:body.id,action:body.action};
 try{
  global.fetch=async(url,options)=>{assert.equal(url,env.APPS_SCRIPT_URL);const input=JSON.parse(options.body);assert.equal(input.op,'action');assert.equal(input.token,'s1.test-session');assert.deepEqual(input.body,body);return Response.json({packed:'compressed',receipt});};
  const response=await worker.fetch(request('/api/action',body),env);assert.equal(response.status,200);assert.deepEqual(await response.json(),{packed:'compressed',receipt});
 }finally{global.fetch=original;}
});

test('lecturas incrementales, historial, solicitudes WMS y conflictos usan el mismo backend',async()=>{
 const original=global.fetch,received=[];
 try{
  global.fetch=async(url,options)=>{received.push(JSON.parse(options.body));return Response.json({status:409,error:'Conflicto',code:'CASE_CHANGED'});};
  for(const [path,body] of [['/api/state?revision=17'],['/api/history?id=case'],['/api/wms/request',{}]]){const response=await worker.fetch(request(path,body),env);assert.equal(response.status,409);assert.equal((await response.json()).code,'CASE_CHANGED');}
  assert.equal(received[0].revision,'17');assert.equal(received[1].id,'case');assert.equal(received[2].op,'wms-request');
 }finally{global.fetch=original;}
});

test('respuestas inválidas o fallas de Google no se anuncian como guardados',async()=>{
 const original=global.fetch;
 try{
  for(const result of [new Response('<html>Error</html>'),Response.json({status:'ready'}),Response.json(null),new Response('busy',{status:503})]){global.fetch=async()=>result;const response=await worker.fetch(request('/api/action',{requestId:'same-request'}),env);assert.equal(response.status,502);assert.ok((await response.json()).error);}
  global.fetch=async()=>{throw Error('network');};assert.equal((await worker.fetch(request('/api/state'),env)).status,502);
 }finally{global.fetch=original;}
});
