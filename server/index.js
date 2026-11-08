import {buildPositionSummary} from '../src/positions.js';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import {OAuth2Client} from 'google-auth-library';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {createStorage} from './storage.js';
import {parseWorkbook} from './imports.js';
import {C3_EMAILS,applyAction,reconcile,actionReceipt} from '../src/domain.js';
const base=path.dirname(path.dirname(fileURLToPath(import.meta.url)));process.chdir(base);
const mode=process.env.DATA_MODE||'demo';const storage=await createStorage(mode);let state=await storage.load();let cache;
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:1}});const auth=new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const pending=new Map();let queue=Promise.resolve();
function serialized(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task;}
function snapshot(){if(!cache||cache.revision!==state.revision)cache={...reconcile(state),positionSummary:buildPositionSummary(state)};return cache;}
app.get('/api/config',(req,res)=>res.json({mode,googleClientId:mode==='sheets'?process.env.GOOGLE_CLIENT_ID:null,manualWms:true}));
app.use('/api',async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  try{
    if(mode==='demo'){req.user={email:'prueba@local.invalid',role:req.headers['x-demo-role']==='C3'?'C3':'C-Administrativo'};return next();}
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');if(!token)return res.status(401).json({error:'Iniciá sesión con Google.'});
    const ticket=await auth.verifyIdToken({idToken:token,audience:process.env.GOOGLE_CLIENT_ID});const p=ticket.getPayload();
    if(!p.email_verified)return res.status(401).json({error:'Google no verificó tu correo.'});
    req.user={email:p.email.toLowerCase(),name:p.name,role:C3_EMAILS.includes(p.email.toLowerCase())?'C3':'C-Administrativo'};next();
  }catch{res.status(401).json({error:'La sesión venció. Volvé a ingresar con Google.'});}
});
app.get('/api/state',(req,res)=>{if(String(state.revision)===req.query.revision)return res.json({unchanged:true,revision:state.revision});res.json({...snapshot(),user:req.user});});
app.get('/api/history',(req,res)=>res.json({events:state.events.filter(e=>!req.query.id||e.caseId===req.query.id).slice().reverse()}));
app.post('/api/action',async(req,res,next)=>{try{await serialized(async()=>{const next=applyAction(state,req.body,req.user);if(next!==state){await storage.save(next,state);state=next;}});res.json({...snapshot(),user:req.user,receipt:actionReceipt(state,req.body)});}catch(e){next(e);}});
app.post('/api/import/preview',upload.single('file'),async(req,res,next)=>{try{
  if(!req.file)throw new Error('Elegí un archivo Excel.');
  const type=req.body.type;
  const parsed=await parseWorkbook(req.file.buffer,type);const id=crypto.randomUUID();
  for(const [k,v] of pending)if(Date.now()-v.at>900000)pending.delete(k);
  if(pending.size>=20)throw new Error('Hay demasiadas importaciones pendientes. Intentá en unos minutos.');
  pending.set(id,{...parsed,type,file:req.file.originalname,user:req.user.email,at:Date.now(),revision:state.revision});res.json({id,rows:parsed.rows.length,previous:state[type].length,warnings:parsed.warnings.slice(0,30),warningCount:parsed.warnings.length,file:req.file.originalname});
}catch(e){next(e);}});
app.post('/api/import/commit',async(req,res,next)=>{try{
  await serialized(async()=>{const p=pending.get(req.body.id);if(!p||p.user!==req.user.email||Date.now()-p.at>900000)throw new Error('La vista previa venció. Seleccioná el archivo nuevamente.');if(state.revision!==p.revision)throw Object.assign(new Error('Los datos cambiaron. Volvé a validar el archivo antes de importarlo.'),{status:409});
    const now=new Date().toISOString(),id=crypto.randomUUID();const meta={...state.meta,[`${p.type}File`]:p.file,[`${p.type}ImportedAt`]:now};if(p.type==='wms'){meta.importedAt=now;meta.importId=id;meta.wmsCapturedAt=null;meta.seenWmsPositions=[...new Set([...(state.meta.seenWmsPositions??[]),...state.wms.map(r=>r[2]),...p.rows.map(r=>r[2])])];}
    const next={...state,[p.type]:p.rows,meta,revision:state.revision+1,events:[...state.events,{id,action:'import',type:p.type,at:now,user:req.user.email,role:req.user.role,file:p.file,rows:p.rows.length,previous:state[p.type].length,warningCount:p.warnings.length}]};await storage.save(next,state);state=next;pending.delete(req.body.id);
  });res.json({...snapshot(),user:req.user});
}catch(e){next(e);}});
app.use('/api',(req,res)=>res.status(404).json({error:'Operación no disponible.'}));
app.get('/seed.json',(req,res,next)=>mode==='sheets'?res.status(404).end():next());
app.use(express.static(path.join(base,'dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.join(base,'dist/index.html')));
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||400).json({error:err.message||'No se pudo completar la operación.',code:err.code});});
const port=Number(process.env.PORT||4173),host=process.env.HOST||(mode==='sheets'?'0.0.0.0':'127.0.0.1');app.listen(port,host,()=>console.log(`Control de inventario: http://${host}:${port} (${mode})`));
