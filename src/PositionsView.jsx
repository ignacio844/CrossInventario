import React,{Fragment,useEffect,useMemo,useState} from 'react';
import {filterPositions,sortPositions} from './positions.js';
import {csvDownload} from './api.js';
import './positions.css';

const number=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:1}).format(value);
const date=value=>new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Argentina/Buenos_Aires'}).format(new Date(value));
const filters=[['all','Todos'],['pending','Sin carga'],['loaded','Con carga'],['unmapped','Sin cross']];

export default function PositionsView({summary,meta}){
 const [status,setStatus]=useState('all'),[query,setQuery]=useState(''),[aisles,setAisles]=useState([]),[deposit,setDeposit]=useState(''),[sort,setSort]=useState('position-asc'),[page,setPage]=useState(0),[expanded,setExpanded]=useState(null);
 const rows=summary?.rows||[];
 const options=useMemo(()=>[...new Set(rows.map(row=>row.aisle).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true})),[rows]);
 const deposits=useMemo(()=>[...new Set(rows.flatMap(row=>row.deposits))].sort(),[rows]);
 const base=useMemo(()=>filterPositions(rows,{query,aisles,deposit}),[rows,query,aisles,deposit]);
 const selected=useMemo(()=>{const [key,direction]=sort.split('-');return sortPositions(filterPositions(base,{status}),{key,direction});},[base,status,sort]);
 const counts=useMemo(()=>Object.fromEntries(filters.map(([key])=>[key,filterPositions(base,{status:key}).length])),[base]);
 const pages=Math.max(1,Math.ceil(selected.length/50));
 useEffect(()=>{setPage(0);setExpanded(null);},[status,query,aisles,deposit,sort]);
 useEffect(()=>{if(page>=pages)setPage(pages-1);},[pages,page]);
 function exportPositions(){csvDownload('posiciones-inventario.csv',[['Posición Octosis','Posición WMS sin cross','Pasillo','Depósitos Octosis','Destinos WMS según cross','Destinos presentes en la descarga','Situación','Cross compartido','Artículos de referencia','Artículos presentes','Cobertura %','Artículos fuera de referencia','Última captura WMS'],...selected.map(row=>[row.original||'',row.wmsOnly||'',row.aisle,row.deposits.join(' / '),row.mapped?row.destinations.join(' / '):'',row.loadedLocations.join(' / '),row.status,row.sharedCross?'Sí':'No',row.referenceCount,row.matchedCount,row.percentage??'No calculable',row.newCount,meta?.wmsCapturedAt||meta?.importedAt||''])]);}
 if(!summary)return <div className="empty" role="status">Cargando posiciones…</div>;
 return <section className="coverage-view" aria-label="Posiciones y cobertura Octosis">
  <div className="coverage-heading"><div><h2>Posiciones</h2><p>Recuento por posición original. La cobertura compara códigos presentes, no valida cantidades.</p></div><div className="coverage-total"><strong>{number(base.length)}</strong><span>posiciones en la selección</span></div></div>
  <div className="coverage-status-filters" role="group" aria-label="Filtrar posiciones por situación">{filters.map(([key,label])=><button key={key} aria-pressed={status===key} onClick={()=>setStatus(key)}>{label}<span>{number(counts[key])}</span></button>)}</div>
  <div className="coverage-filters">
   <input type="search" aria-label="Buscar en posiciones" placeholder="Posición, artículo o código de barras…" value={query} onChange={event=>setQuery(event.target.value)}/>
   <Aisles options={options} selected={aisles} onChange={setAisles}/>
   <select aria-label="Depósito Octosis de posiciones" value={deposit} onChange={event=>setDeposit(event.target.value)}><option value="">Todos los depósitos</option>{deposits.map(value=><option key={value}>{value}</option>)}</select>
   <select aria-label="Orden de posiciones" value={sort} onChange={event=>setSort(event.target.value)}><option value="position-asc">Posición: menor a mayor</option><option value="position-desc">Posición: mayor a menor</option><option value="coverage-asc">Cobertura: menor a mayor</option><option value="coverage-desc">Cobertura: mayor a menor</option></select>
   {(query||aisles.length>0||deposit||status!=='all')&&<button onClick={()=>{setQuery('');setAisles([]);setDeposit('');setStatus('all');}}>Limpiar filtros</button>}
   <button onClick={exportPositions} disabled={!selected.length}>Exportar posiciones</button>
  </div>
  <div className="coverage-caption"><span>{meta?.wmsCapturedAt||meta?.importedAt?'Stock WMS al '+date(meta.wmsCapturedAt||meta.importedAt):'Según la última descarga WMS disponible.'}</span><span>Con carga incluye posiciones con carga previa. Sin cross es una observación que puede coincidir con Con carga.</span></div>
  <div className="coverage-table-wrap"><table className="coverage-table"><thead><tr><th scope="col">Posición Octosis</th><th scope="col">Destinos WMS / cross</th><th scope="col">Artículos Octosis</th><th scope="col">Cobertura Octosis</th><th scope="col">Situación</th><th scope="col">Detalle</th></tr></thead><tbody>{selected.slice(page*50,(page+1)*50).map(row=><Fragment key={row.id}>
   <tr><td data-label="Posición Octosis"><strong>{row.original||'Sin referencia Octosis'}</strong><small>Pasillo {row.aisle||'sin identificar'}{row.deposits.length?' · '+row.deposits.join(' / '):''}</small>{!row.original&&<small>Posición WMS: {row.wmsOnly}</small>}</td>
    <td data-label="Destinos WMS / cross"><div className="coverage-destinations">{row.destinations.length?row.destinations.map(position=><span key={position} className={row.loadedLocations.includes(position)?'current':''}>{position}<small>{row.loadedLocations.includes(position)?'En última descarga':row.mapped?'Según cross':'Carga previa'}</small></span>):<small>Sin correspondencia para verificar</small>}</div>{row.sharedCross&&<small className="coverage-shared">Cross compartido · la presencia no identifica el origen físico.</small>}</td>
    <td data-label="Artículos Octosis"><strong>{number(row.referenceCount)}</strong><small>códigos con saldo positivo</small></td>
    <td data-label="Cobertura Octosis"><Coverage row={row}/>{row.newCount>0&&<small>{number(row.newCount)} artículo{row.newCount===1?'':'s'} WMS fuera de la referencia positiva</small>}</td>
    <td data-label="Situación"><span className={'coverage-state '+(!row.mapped?'unknown':row.hasLoad?'loaded':'pending')}>{row.status}</span>{row.hasLoad&&!row.hasCurrent&&<small>Sin registro en la última descarga</small>}{!row.mapped&&row.hasLoad&&<small>Sin cross / referencia Octosis</small>}</td>
    <td data-label="Detalle"><button className="coverage-detail-button" aria-expanded={expanded===row.id} aria-controls={'coverage-detail-'+encodeURIComponent(row.id)} onClick={()=>setExpanded(expanded===row.id?null:row.id)}>{expanded===row.id?'Ocultar artículos':'Ver artículos'}</button></td></tr>
   {expanded===row.id&&<tr className="coverage-detail-row"><td colSpan={6}><ArticleDetails row={row}/></td></tr>}
  </Fragment>)}</tbody></table>{!selected.length&&<div className="empty"><h3>No hay posiciones con estos filtros</h3><p>Probá otro pasillo, depósito o situación.</p></div>}</div>
  <div className="pagination"><span>{number(selected.length)} de {number(rows.length)} posiciones · Una fila por referencia.</span><div><button disabled={page===0} onClick={()=>setPage(page-1)}>Anterior</button><span>{page+1} / {pages}</span><button disabled={page+1>=pages} onClick={()=>setPage(page+1)}>Siguiente</button></div></div>
  <p className="coverage-legend">100 % indica presencia de todos los códigos de referencia; las diferencias de cantidad se revisan en Por analizar. Se usan las relaciones directas del cross. Los destinos previstos no se consideran stock cargado hasta aparecer en WMS.</p>
 </section>;
}

function Coverage({row}){
 if(row.percentage===null)return <div className="coverage-unavailable"><strong>No calculable</strong><small>{!row.mapped?'Falta cross / referencia Octosis':'Sin saldo positivo de referencia en Octosis'}</small></div>;
 const label=number(row.matchedCount)+' de '+number(row.referenceCount)+' artículos · '+number(row.percentage)+' %';
 return <div className="coverage-progress"><div><strong>{number(row.percentage)} %</strong><span>{number(row.matchedCount)} de {number(row.referenceCount)} artículos</span></div><progress max={row.referenceCount} value={row.matchedCount} aria-label={'Cobertura Octosis de '+(row.original||row.wmsOnly)} aria-valuetext={label}/></div>;
}

function Aisles({options,selected,onChange}){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false);
 function toggle(value){onChange(selected.includes(value)?selected.filter(item=>item!==value):[...selected,value]);}
 return <details className="coverage-aisles" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary title={selected.join(' · ')}>Pasillos: {selected.length?selected.join(' · '):'Todos'}</summary><div className="coverage-aisle-menu"><input aria-label="Buscar pasillos de posiciones" placeholder="Ej. 2B, 2C…" value={query} onChange={event=>setQuery(event.target.value)}/><div role="group" aria-label="Pasillos de posiciones">{options.filter(value=>value.includes(query.trim().toUpperCase())).map(value=><label key={value}><input type="checkbox" aria-label={'Pasillo '+value} checked={selected.includes(value)} onChange={()=>toggle(value)}/>{value}</label>)}</div><div className="coverage-aisle-actions"><button type="button" onClick={()=>onChange([])}>Quitar selección</button><button type="button" onClick={()=>setOpen(false)}>Listo</button></div></div></details>;
}

function ArticleDetails({row}){
 return <div className="coverage-article-details" id={'coverage-detail-'+encodeURIComponent(row.id)}><h3>Artículos · {row.original||row.wmsOnly}</h3><p>Consulta de la última descarga. Esta vista no cambia estados ni solicita conteos.</p>{row.articles.length?<ul>{row.articles.map(article=><li key={article.sku}><div><strong>{article.sku}</strong><small>{article.description}{article.barcode?' · Código de barras: '+article.barcode:''}</small></div><span>Octosis: {article.oldQty===null?'Sin referencia':number(article.oldQty)}</span><span>WMS: {article.wmsQty===null?'No figura':number(article.wmsQty)}</span><span className={'coverage-article-state '+(article.present?'present':'absent')}>{article.reference?(article.present?'Presente':'Sin saldo positivo WMS'):'Fuera de referencia positiva'}</span></li>)}</ul>:<p>No hay artículos con saldo positivo en las fuentes de esta posición.</p>}</div>;
}
