import ExcelJS from 'exceljs';
import {DEPOSITS,wmsKey} from '../src/domain.js';
const text=v=>String(v??'').trim();
function value(c){const v=c?.value;if(v&&typeof v==='object'){if('result'in v)return v.result;if('richText'in v)return v.richText.map(t=>t.text).join('');throw new Error('Hay una fórmula sin resultado o un tipo de celda no admitido. Exportá el reporte con valores.');}return v;}
const num=(v,label)=>{if(v===null||v===undefined||v==='')throw new Error(`${label}: cantidad vacía.`);const n=Number(v);if(!Number.isFinite(n))throw new Error(`${label}: cantidad inválida.`);return n;};
export async function parseWorkbook(buffer,type){
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);let rows=[];const warnings=[];
 if(type==='cross'){
   for(const s of book.worksheets){if(s.name.toUpperCase()==='HISTORICO')continue;
     let header=0;s.eachRow((r,i)=>{if(text(value(r.getCell(1))).toUpperCase()==='WMS'&&text(value(r.getCell(2))).toUpperCase()==='OCTOSIS')header=i;});
     if(!header)continue;
     s.eachRow((r,i)=>{if(i<=header)return;const a=text(value(r.getCell(1))),b=text(value(r.getCell(2)));if(!a&&!b)return;if(!a||!b){warnings.push(`${s.name}, fila ${i}: correspondencia incompleta, omitida.`);return;}rows.push([wmsKey(a),b]);});
   }
 }else{
   const s=book.worksheets[0];if(!s)throw new Error('El archivo no tiene hojas.');
   const headers={};s.getRow(1).eachCell((c,i)=>{headers[text(value(c)).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()]=i;});
   const required={octosis:['CODIGO','SALDO','ESTANTERIA','DEPOSITO'],products:['CODIGO','DESCRIPCION','BULTO'],wms:['COD. ART','UNIDADES','CARA','COLUMNA','NIVEL','PROFUNDIDAD','CONTENEDOR','BULTOS','ARTICULO','DEPOSITO']}[type];
   if(!required)throw new Error('Tipo de archivo desconocido.');
   for(const h of required)if(!headers[h])throw new Error(`Falta la columna ${h}. Elegiste un tipo de archivo incorrecto o cambió el formato.`);
   const get=(r,h)=>value(r.getCell(headers[h]));
   s.eachRow((r,i)=>{if(i===1)return;const sku=text(get(r,type==='wms'?'COD. ART':'CODIGO'));if(!sku)return;
     if(type==='octosis'){const dep=text(get(r,'DEPOSITO'));if(!DEPOSITS.includes(dep))return;const q=num(get(r,'SALDO'),`Fila ${i}`);if(q<0)warnings.push(`Fila ${i}: saldo negativo (${sku}).`);rows.push([sku,q,text(get(r,'ESTANTERIA')),dep]);}
     if(type==='products'){const q=num(get(r,'BULTO'),`Fila ${i}, BULTO`);if(q<=0)throw new Error(`Fila ${i}: BULTO debe ser mayor a cero.`);const barcodeHeader=['CODIGO DE BARRAS','CODIGO DE BARRA','CODIGO BARRAS','CODIGO BARRA'].find(h=>headers[h]);rows.push([sku,text(get(r,'DESCRIPCION')),q,barcodeHeader?text(get(r,barcodeHeader)):'']);}
     if(type==='wms'){if(text(get(r,'DEPOSITO')).toUpperCase()!=='CD ESCOBAR')throw new Error(`Fila ${i}: el reporte incluye otro depósito. Exportá solamente CD ESCOBAR.`);const q=num(get(r,'UNIDADES'),`Fila ${i}`);if(q<0)warnings.push(`Fila ${i}: stock WMS negativo (${sku}).`);const pos=['CARA','COLUMNA','NIVEL'].map(h=>text(get(r,h)));if(pos.some(x=>!x))throw new Error(`Fila ${i}: posición incompleta.`);rows.push([sku,q,wmsKey(pos.join(' ')),text(get(r,'PROFUNDIDAD')),text(get(r,'CONTENEDOR')),num(get(r,'BULTOS'),`Fila ${i}, BULTOS`),text(get(r,'ARTICULO'))]);}
   });
 }
 if(!rows.length)throw new Error('El archivo no contiene registros válidos para este alcance. No se reemplazaron los datos.');
 if(type==='products'&&new Set(rows.map(r=>r[0])).size!==rows.length)throw new Error('El maestro contiene códigos repetidos. Revisalos antes de importar.');
 return {rows,warnings};
}
