import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {parseWorkbook} from '../server/imports.js';
import {reconcile,applyAction,C3_EMAILS} from '../src/domain.js';
import {tableRow,columnMatches} from '../src/table.js';
import {restoreSession,saveSession,clearSession} from '../src/session.js';

function fixture(position='A 001 01'){
 return {octosis:[['SKU',5,'OLD1','DISTRIMAR B']],products:[['SKU','Articulo',1,'001234567890']],cross:[['A 001 01','OLD1'],['A 001 01','OLD2'],['A 002 01','OLD2']],wms:[['SKU',5,position,'','',5,'Articulo']],cases:{},events:[],meta:{},revision:0};
}
test('código de barras conserva ceros, aparece en la conciliación y se puede buscar',async()=>{
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Productos');
 sheet.addRow(['Código','Descripción','Bulto','Código de barras']);sheet.addRow(['SKU','Articulo',1,'001234567890']);
 const products=(await parseWorkbook(await workbook.xlsx.writeBuffer(),'products')).rows;
 assert.equal(products[0][3],'001234567890');
 const row=tableRow(reconcile({...fixture(),products}).rows[0]);
 assert.equal(row.barcode,'001234567890');assert.equal(columnMatches(row,{article:'001234567890'}),true);
});
test('aceptar cantidad y ubicación coincidentes admite motivo vacío; ubicación distinta lo exige',()=>{
 const user={email:C3_EMAILS[0],role:'C3'},data=fixture(),row=reconcile(data).rows[0];
 assert.equal(row.locationMatches,true);
 const action={id:row.id,action:'accept',reason:'',expectedRevision:0,requestId:'one'};
 assert.equal(applyAction(data,action,user).cases[row.id].status,'Aceptado');
 const different=fixture('A 002 01'),other=reconcile(different).rows[0];
 assert.equal(other.kind,'Coincide');assert.equal(other.locationMatches,false);
 assert.throws(()=>applyAction(different,{...action,id:other.id},user),/motivo/);
});
test('las posiciones previstas del cross no se presentan como cargadas y C2 está disponible para todos los roles autenticados',()=>{
 const data=fixture(),row=reconcile(data).rows[0];
 assert.deepEqual(tableRow(row).loadedLocations,['A 001 01']);
 assert.deepEqual(tableRow({...row,wmsDetails:[],wmsPresent:false}).loadedLocations,[]);
 for(const role of ['C-Administrativo','C3','C1','C2'])assert.equal(applyAction(data,{id:row.id,action:'request-c2',reason:'Segundo control',expectedRevision:0},{email:'operario@example.com',role}).cases[row.id].status,'Solicitado C2');
});
test('sesión persistida se restaura al recargar, se limpia al salir y se rechaza si venció',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 saveSession(storage,{token:'s1.random',expiresAt:2000,user:{role:'C3'}});
 assert.equal(restoreSession(storage,1000).token,'s1.random');assert.equal(restoreSession(storage,2001),null);
 clearSession(storage);assert.equal(restoreSession(storage,1000),null);
});
test('Apps Script valida sesiones persistentes, deriva el rol del servidor y revoca el acceso al salir',()=>{
 const properties=new Map(),cache=new Map();
 const context=vm.createContext({
  Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,value)=>[...createHash(algorithm).update(value).digest()]},
  PropertiesService:{getScriptProperties:()=>({getProperties:()=>Object.fromEntries(properties),getProperty:key=>properties.get(key)||null,setProperty:(key,value)=>properties.set(key,value),deleteProperty:key=>properties.delete(key)})},
  CacheService:{getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,value),remove:key=>cache.delete(key)})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({value,setMimeType(){return this;}})}
 });
 vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs',import.meta.url),'utf8'),context);
 const session=vm.runInContext("createSession_({email:C3_EMAILS[0],role:'C3'})",context);context.sessionToken=session.token;
 assert.ok(session.token.startsWith('s1.'));assert.equal(vm.runInContext('user_(sessionToken).role',context),'C3');
 const result=vm.runInContext("doPost({postData:{contents:JSON.stringify({op:'logout',token:sessionToken})}})",context);
 assert.equal(JSON.parse(result.value).signedOut,true);assert.throws(()=>vm.runInContext('user_(sessionToken)',context),/sesión venció/);
 assert.throws(()=>vm.runInContext("user_('s1.fake')",context),/sesión venció/);
});
