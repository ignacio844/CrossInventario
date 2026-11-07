import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseWorkbook} from '../server/imports.js';
async function fixture(rows){const w=new ExcelJS.Workbook();const s=w.addWorksheet('Datos');rows.forEach(r=>s.addRow(r));return w.xlsx.writeBuffer();}
test('importación inválida no admite formato equivocado ni cantidades vacías',async()=>{
 await assert.rejects(()=>parseWorkbook(new Uint8Array([1,2]),'wms'));
 const p=await fixture([['CODIGO','DESCRIPCION','BULTO'],['X','Ejemplo',null]]);await assert.rejects(()=>parseWorkbook(p,'products'),/vacía/);
});
test('maestro rechaza códigos duplicados y factores no positivos',async()=>{
 const p=await fixture([['CODIGO','DESCRIPCION','BULTO'],['X','Ejemplo',1],['X','Ejemplo',2]]);await assert.rejects(()=>parseWorkbook(p,'products'),/repetidos/);
 const q=await fixture([['CODIGO','DESCRIPCION','BULTO'],['X','Ejemplo',0]]);await assert.rejects(()=>parseWorkbook(q,'products'),/mayor a cero/);
});
test('Octosis filtra depósitos pero conserva códigos y filas repetidas',async()=>{
 const p=await fixture([['Código','Saldo','Estanteria','Deposito'],['001X',10,'1A / 1 1','DISTRIMAR B'],['001X',5,'1A / 1 1','DISTRIMAR B'],['001X',4,'1A / 1 1','DISTRIMAR N'],['001X',99,'1A / 1 1','DISTRIMAR REV']]);const r=await parseWorkbook(p,'octosis');assert.equal(r.rows.length,3);assert.equal(r.rows[0][0],'001X');assert.equal(r.rows.reduce((s,r)=>s+r[1],0),19);assert.equal(r.rows[2][3],'DISTRIMAR N');
});
