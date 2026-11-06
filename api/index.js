// Gateway sin estado para Vercel. La exclusión mutua y la persistencia viven en Apps Script.
export const config={maxDuration:60};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const url=new URL(req.url,'https://local.invalid');const route=String(req.query?.route??url.searchParams.get('route')??'').replace(/^\/+|\/+$/g,'');
 if(route==='config'&&req.method==='GET')return res.status(200).json({mode:'sheets',backend:'apps-script',googleClientId:process.env.GOOGLE_CLIENT_ID||'1017155266531-5278r2b4svs70k4o2lu3o7hl8efvlgtk.apps.googleusercontent.com',manualWms:true,backendConfigured:!!process.env.APPS_SCRIPT_URL});
 const endpoint=process.env.APPS_SCRIPT_URL;
 if(!endpoint)return res.status(503).json({error:'Falta configurar APPS_SCRIPT_URL en Vercel. Consultá DEPLOY_VERCEL.md.'});
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint))return res.status(503).json({error:'APPS_SCRIPT_URL debe ser la URL /exec del despliegue Apps Script.'});
 const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return res.status(401).json({error:'Iniciá sesión con Google.'});
 const routes={'POST:session':'session','POST:logout':'logout','GET:state':'state','GET:history':'history','POST:action':'action','POST:import/preview':'preview','POST:import/commit':'import'};
 const op=routes[req.method+':'+route];if(!op)return res.status(404).json({error:'Operación no disponible.'});
 let body=req.body??{};if(typeof body==='string'){try{body=JSON.parse(body);}catch{return res.status(400).json({error:'Solicitud inválida.'});}}
 try{
  const response=await fetch(endpoint,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({op,token,revision:url.searchParams.get('revision'),id:url.searchParams.get('id'),body}),signal:AbortSignal.timeout(55000)});
  if(!response.ok)return res.status(502).json({error:'Apps Script no respondió correctamente. Intentá nuevamente.'});
  const raw=await response.text();let result;try{result=JSON.parse(raw);}catch{return res.status(502).json({error:'El despliegue Apps Script devolvió una página en lugar de datos. Revisá su URL y el acceso del despliegue.'});}
  return res.status(result.status||200).json(result);
 }catch{return res.status(502).json({error:'No se pudo confirmar la operación. Actualizá la vista antes de reintentar; no se mostrará como guardada hasta verificarla.'});}
}
