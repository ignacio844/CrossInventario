// Cloudflare hosts the same app and forwards authenticated operations to Google.
const routes={'POST:wms/request':'wms-request','POST:wms/pair':'wms-pair','POST:session':'session','POST:logout':'logout','GET:state':'state','GET:history':'history','POST:action':'action','POST:import/preview':'preview','POST:import/commit':'import'};
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
  const route=url.pathname.slice(5).replace(/\/+$/,'');
  if(route==='config'&&request.method==='GET')return json({mode:'sheets',backend:'apps-script',googleClientId:env.GOOGLE_CLIENT_ID,manualWms:false,wmsSync:true,backendConfigured:!!env.APPS_SCRIPT_URL});
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(env.APPS_SCRIPT_URL||''))return json({error:'Falta configurar el servidor Google.'},503);
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return json({error:'Iniciá sesión con Google.'},401);
  const op=routes[request.method+':'+route];if(!op)return json({error:'Operación no disponible.'},404);
  let body={};if(request.method==='POST'){try{body=await request.json();}catch{return json({error:'Solicitud inválida.'},400);}}
  try{
   const response=await fetch(env.APPS_SCRIPT_URL,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({op,token,revision:url.searchParams.get('revision'),id:url.searchParams.get('id'),body}),signal:AbortSignal.timeout(55000)});
   if(!response.ok)return json({error:'Google está ocupado. Tu texto se conserva; reintentá guardar.'},response.status===429?429:502);
   let result;try{result=await response.json();}catch{return json({error:'Google no confirmó la operación. Tu texto se conserva.'},502);}
   if(!result||typeof result!=='object'||Array.isArray(result))return json({error:'Respuesta de Google inválida. Tu texto se conserva.'},502);
   const status=result.status===undefined?200:Number(result.status);
   if(!Number.isInteger(status)||status<200||status>599)return json({error:'Respuesta de Google inválida. Tu texto se conserva.'},502);
   return json(result,status);
  }catch{return json({error:'No se pudo confirmar la operación. Tu texto se conserva; podés reintentar sin duplicar la acción.'},502);}
 }
};
