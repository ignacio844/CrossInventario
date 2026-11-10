import {isResolved} from './domain.js';

const text = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const positionText = value => text(value).replace(/[\s/]+/g, '');
const unique = values => [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es', {numeric:true}));

export function tableRow(row) {
  const original = unique(row.oldDetails.map(detail => detail.position));
  const loadedLocations=unique(row.wmsDetails.map(detail=>detail.position));
  const loadedPositionDetails=loadedLocations.map(position=>({position,containers:unique(row.wmsDetails.filter(detail=>detail.position===position).map(detail=>String(detail.container??'').trim()))}));
  const stock=new Map();
  for(const detail of row.wmsDetails){
    if(!Number.isFinite(detail.quantity))continue;
    const container=String(detail.container??'').trim(),key=JSON.stringify([detail.position,container]);
    if(!stock.has(key))stock.set(key,{position:detail.position,container,quantity:0});
    stock.get(key).quantity+=detail.quantity;
  }
  const wmsStockLines=[...stock.values()].sort((a,b)=>a.position.localeCompare(b.position,'es',{numeric:true})||a.container.localeCompare(b.container,'es',{numeric:true}));
  return {
    ...row,
    ...reviewState(row),
    originalLocations: original.length ? original : unique(row.crossOriginalLocations||[]),
    loadedLocations,
    loadedPositionDetails,
    wmsStockLines,
    containers:unique(loadedPositionDetails.flatMap(detail=>detail.containers))
  };
}

export function reviewState(row) {
  const done=isResolved(row),issues=[];
  if(row.kind&&row.kind!=='Coincide')issues.push(row.kind==='No figura en fuentes'?'Sin registro en este grupo':row.kind);
  if(row.locationMatches===false)issues.push(row.mapped===false?'Sin cross':'Ubicación distinta');
  if(row.saleUnit===null)issues.push('Sin unidad de venta');
  const reviewedDelta=row.reviewedDelta===undefined?row.delta:row.reviewedDelta;
  const observation=done?(row.closurePreserved?(reviewedDelta===null?'Cierre conservado':reviewedDelta!==0?'Diferencia aceptada':'Inventario confirmado'):reviewedDelta!==0?'Diferencia aceptada':issues.length?'Observación aceptada':'Sin diferencias'):(issues[0]||'Por revisar');
  return {pendingDelta:done?0:row.delta,observation,issues,needsAnalysis:!!row.active&&!done,acceptedDifference:done&&reviewedDelta!==null&&reviewedDelta!==0};
}

export function matchesReviewFilter(row,filter) {
  const state=reviewState(row);
  switch(filter) {
    case 'analysis': return state.needsAnalysis;
    case 'different': return state.needsAnalysis&&row.delta!==0;
    case 'accepted': return state.acceptedDifference;
    case 'post-review': return !!row.closurePreserved;
    case 'mapping': return state.needsAnalysis&&(!row.mapped||row.locationMatches===false);
    case 'unit': return row.saleUnit===null;
    case 'recorded': return !!row.review?.updatedAt||!!row.review?.note;
    case 'notes': return !!row.review?.note?.text;
    default: return true;
  }
}

export function numberMatches(value, filter) {
  if (!filter.trim()) return true;
  if (value === null || value === undefined) return false;
  const match = filter.trim().match(/^(>=|<=|!=|<>|>|<|=)?\s*(-?[\d.,]+)$/);
  if (!match) return false;
  let number = match[2];
  if (number.includes(',')) number = number.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(number)) number = number.replace(/\./g, '');
  const expected = Number(number);
  if (!Number.isFinite(expected)) return false;
  switch (match[1]) {
    case '>': return value > expected;
    case '<': return value < expected;
    case '>=': return value >= expected;
    case '<=': return value <= expected;
    case '!=': case '<>': return value !== expected;
    default: return value === expected;
  }
}

export function positionAisle(position) {
  const normalized=String(position??'').normalize('NFKC').trim().toUpperCase().replace(/\s+/g,'');
  return normalized.match(/^(?:\d+[A-Z]+|[A-Z]+)/)?.[0]||'';
}
export function aisleMatches(positions, selected=[]) {
  return !selected.length||positions.some(position=>selected.includes(positionAisle(position)));
}
export function columnMatches(row, filters, aisles={}) {
  const contains = (value, filter) => !filter || text(value).includes(text(filter));
  const positionMatches = (values, filter) => !filter || values.some(value => positionText(value).includes(positionText(filter)));
  return positionMatches(row.originalLocations, filters.original || '') &&
    positionMatches([...row.loadedLocations,...(row.containers||[])], filters.loaded || '') &&
    aisleMatches(row.originalLocations,aisles.original) &&
    aisleMatches(row.loadedLocations,aisles.loaded) &&
    contains(row.sku + ' ' + row.description + ' ' + (row.barcode||''), filters.article) &&
    numberMatches(row.saleUnit, filters.saleUnit || '') &&
    numberMatches(row.oldPresent ? row.oldQty : null, filters.oldQty || '') &&
    numberMatches(row.wmsPresent ? row.wmsQty : null, filters.wmsQty || '') &&
    numberMatches(row.delta, filters.delta || '') &&
    numberMatches(row.pendingDelta, filters.pendingDelta || '') &&
    contains(row.kind+(row.locationMatches===false?' Ubicación distinta':''), filters.kind) &&
    contains(row.observation,filters.observation) &&
    contains(row.status, filters.status);
}

export const numericColumns = new Set(['saleUnit','oldQty','wmsQty','delta','pendingDelta']);
export function columnValues(row, key) {
  switch(key) {
    case 'original': return row.originalLocations;
    case 'loaded': return row.loadedLocations;
    case 'article': return [row.sku,row.description,row.barcode].filter(Boolean);
    case 'oldQty': return row.oldPresent ? [row.oldQty] : [];
    case 'wmsQty': return row.wmsPresent ? [row.wmsQty] : [];
    case 'kind': return [row.kind,...(row.locationMatches===false?['Ubicación distinta']:[])];
    default: return row[key] == null ? [] : [row[key]];
  }
}
const collator = new Intl.Collator('es',{numeric:true,sensitivity:'base'});
export function sortRows(rows, sort) {
  if(!sort?.key)return rows;
  const direction=sort.direction==='desc'?-1:1;
  const value=row=>columnValues(row,sort.key)[0];
  return [...rows].sort((a,b)=>{
    const left=value(a),right=value(b);
    const emptyLeft=left===undefined||left==='',emptyRight=right===undefined||right==='';
    if(emptyLeft||emptyRight)return Number(emptyLeft)-Number(emptyRight);
    const order=numericColumns.has(sort.key)?left-right:collator.compare(String(left),String(right));
    return direction*order||collator.compare(a.sku,b.sku)||collator.compare(a.id,b.id);
  });
}
export function columnOptions(rows,key) {
  const format=value=>numericColumns.has(key)?String(value).replace('.',','):String(value);
  return [...new Set(rows.flatMap(row=>[...columnValues(row,key),...(key==='loaded'?row.containers||[]:[])]).map(format))]
    .sort((a,b)=>numericColumns.has(key)?Number(a.replace(',','.'))-Number(b.replace(',','.')):collator.compare(a,b));
}
export function aisleOptions(rows,key) {
  if(!['original','loaded'].includes(key))return [];
  return unique(rows.flatMap(row=>columnValues(row,key)).map(positionAisle));
}
export function suggestValues(options,query,key,limit=12) {
  const search=text(query);
  return options.filter(value=>{
    if(!search)return true;
    if(numericColumns.has(key)&&/^[<>=!]/.test(search))return numberMatches(Number(value.replace(',','.')),query);
    return ['original','loaded'].includes(key)?positionText(value).includes(positionText(query)):text(value).includes(search);
  }).slice(0,limit);
}
