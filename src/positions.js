import {DEPOSITS,octPositionKey,wmsKey} from './domain.js';
import {positionAisle} from './table.js';

const collator=new Intl.Collator('es',{numeric:true,sensitivity:'base'});
const sorted=values=>[...values].sort(collator.compare);
const searchText=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();

// A read-only projection of the same source snapshot used by the control table.
// Direct links are deliberate: a transitive cross group is not a position.
export function buildPositionSummary(data){
 const original=new Map(),destinations=new Map(),origins=new Map(),crossLabels=new Map(),loaded=new Map();
 for(const [rawWms,rawOld] of data.cross||[]){
  const old=octPositionKey(rawOld),wms=wmsKey(rawWms);if(!old||!wms)continue;
  if(!destinations.has(old))destinations.set(old,new Set());destinations.get(old).add(wms);
  if(!origins.has(wms))origins.set(wms,new Set());origins.get(wms).add(old);
  if(!crossLabels.has(old))crossLabels.set(old,String(rawOld).trim());
 }
 for(const [sku,quantity,position,deposit] of data.octosis||[]){
  if(!DEPOSITS.includes(deposit)||!Number.isFinite(quantity))continue;
  const key=octPositionKey(position);if(!key)continue;
  if(!original.has(key))original.set(key,{label:String(position).trim(),quantities:new Map(),deposits:new Set()});
  const entry=original.get(key);entry.quantities.set(sku,(entry.quantities.get(sku)||0)+quantity);entry.deposits.add(deposit);
 }
 for(const [sku,quantity,position] of data.wms||[]){
  const key=wmsKey(position);if(!key||!Number.isFinite(quantity))continue;
  if(!loaded.has(key))loaded.set(key,new Map());const entry=loaded.get(key);entry.set(sku,(entry.get(sku)||0)+quantity);
 }
 const seen=new Set([...(data.meta?.seenWmsPositions||[]).map(wmsKey),...loaded.keys()].filter(Boolean));
 const candidates=new Set([...original].filter(([,entry])=>[...entry.quantities.values()].some(quantity=>quantity>0)).map(([key])=>key));
 for(const wms of seen)for(const old of origins.get(wms)||[])candidates.add(old);
 const products=new Map((data.products||[]).map(product=>[product[0],product]));
 function make(old,wmsOnly){
  const entry=old?original.get(old):null,target=old?sorted(destinations.get(old)||[]):[wmsOnly];
  const mapped=!!old&&target.length>0,reference=new Map([...(entry?.quantities||[])].filter(([,quantity])=>quantity>0)),current=new Map();
  for(const position of target)for(const [sku,quantity] of loaded.get(position)||[])current.set(sku,(current.get(sku)||0)+quantity);
  const actual=target.filter(position=>loaded.has(position)),previous=target.some(position=>seen.has(position));
  const hasLoad=actual.length>0||previous,referenceCount=reference.size;
  const matchedCount=[...reference.keys()].filter(sku=>(current.get(sku)||0)>0).length;
  const percentage=mapped&&referenceCount?Math.round(matchedCount/referenceCount*1000)/10:null;
  const articleKeys=new Set([...reference.keys(),...[...current].filter(([,quantity])=>quantity>0).map(([sku])=>sku)]);
  const articles=sorted(articleKeys).map(sku=>({sku,description:products.get(sku)?.[1]||'',barcode:String(products.get(sku)?.[3]??''),reference:reference.has(sku),oldQty:entry?.quantities.get(sku)??null,wmsQty:current.get(sku)??null,present:(current.get(sku)||0)>0}));
  const label=old?(entry?.label||crossLabels.get(old)||old):null;
  return {id:old?'o:'+old:'w:'+wmsOnly,original:label,wmsOnly,aisle:positionAisle(label||wmsOnly),destinations:target,loadedLocations:actual,deposits:sorted(entry?.deposits||[]),mapped,hasLoad,hasCurrent:actual.length>0,sharedCross:target.some(position=>(origins.get(position)?.size||0)>1),referenceCount,matchedCount,percentage,newCount:articles.filter(article=>!article.reference&&article.present).length,articles,status:actual.length?'Con carga':previous?'Con carga previa':mapped?'Sin carga':'Sin cross'};
 }
 const rows=[...candidates].map(old=>make(old));
 for(const wms of seen)if(!origins.has(wms))rows.push(make(null,wms));
 rows.sort((a,b)=>collator.compare(a.original||a.wmsOnly,b.original||b.wmsOnly));
 return {rows,stats:{total:rows.length,pending:rows.filter(row=>row.mapped&&!row.hasLoad).length,loaded:rows.filter(row=>row.hasLoad).length,unmapped:rows.filter(row=>!row.mapped).length}};
}

export function filterPositions(rows,{status='all',query='',aisles=[],deposit=''}={}){
 const queryText=searchText(query),compact=queryText.replace(/[\s/]+/g,'');
 return rows.filter(row=>{
  if(status==='pending'&&(!row.mapped||row.hasLoad))return false;
  if(status==='loaded'&&!row.hasLoad)return false;
  if(status==='unmapped'&&row.mapped)return false;
  if(aisles.length&&!aisles.includes(row.aisle))return false;
  if(deposit&&!row.deposits.includes(deposit))return false;
  return !queryText||searchText([row.original,row.wmsOnly,...row.destinations,...row.deposits,...row.articles.map(article=>article.sku+' '+article.barcode+' '+article.description)].join(' ')).includes(queryText)||compact.length>0&&[row.original,row.wmsOnly,...row.destinations].some(position=>searchText(position).replace(/[\s/]+/g,'').includes(compact));
 });
}

export function sortPositions(rows,{key='position',direction='asc'}={}){
 const multiplier=direction==='desc'?-1:1;
 return [...rows].sort((a,b)=>{
  if(key==='coverage'){
   if(a.percentage===null||b.percentage===null)return Number(a.percentage===null)-Number(b.percentage===null)||collator.compare(a.original||a.wmsOnly,b.original||b.wmsOnly);
   return multiplier*(a.percentage-b.percentage)||collator.compare(a.original||a.wmsOnly,b.original||b.wmsOnly);
  }
  return multiplier*collator.compare(a.original||a.wmsOnly,b.original||b.wmsOnly);
 });
}
