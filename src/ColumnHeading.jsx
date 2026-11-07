import React,{useEffect,useMemo,useState,useId} from 'react';
import {columnOptions,numericColumns,suggestValues,aisleOptions} from './table.js';

export default function ColumnHeading({label,column,rows,value,onFilter,sort,onSort,open,onToggle,onClose,selectedAisles=[],onAisles}) {
  const numeric=numericColumns.has(column),sorted=sort?.key===column;
  return <th scope="col" className={'filter-heading '+(value||selectedAisles.length||sorted?'filtered':'')} aria-sort={sorted?(sort.direction==='asc'?'ascending':'descending'):'none'}>
    <button className="filter-trigger" aria-label={'Abrir filtro de '+label} aria-expanded={open} onClick={onToggle}>
      <span>{label}{sorted&&<span className="sort-indicator" aria-hidden="true">{sort.direction==='asc'?' ↑':' ↓'}</span>}{selectedAisles.length>0&&<small className="aisle-selection-summary" title={'Pasillos: '+selectedAisles.join(', ')}>{selectedAisles.join(' · ')}</small>}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8Z"/></svg>
    </button>
    {open&&<FilterMenu {...{label,column,rows,value,onFilter,sort,onSort,onClose,numeric,selectedAisles,onAisles}}/>}
  </th>;
}

function FilterMenu({label,column,rows,value,onFilter,sort,onSort,onClose,numeric,selectedAisles,onAisles}) {
  const positionColumn=['original','loaded'].includes(column);
  const listId=useId(),[highlight,setHighlight]=useState(-1);
  const options=useMemo(()=>columnOptions(rows,column),[rows,column]);
  const suggestions=useMemo(()=>suggestValues(options,value,column,positionColumn?5:12),[options,value,column,positionColumn]);
  useEffect(()=>setHighlight(-1),[value]);
  const select=value=>{onFilter(value);onClose();};
  function keyDown(event) {
    if(event.key==='ArrowDown'){event.preventDefault();setHighlight(previous=>Math.min(previous+1,suggestions.length-1));}
    if(event.key==='ArrowUp'){event.preventDefault();setHighlight(previous=>Math.max(previous-1,0));}
    if(event.key==='Enter'){event.preventDefault();if(highlight>=0&&suggestions[highlight]!==undefined)select(suggestions[highlight]);else onClose();}
  }
  const content=<>
    <label className="filter-content-label">Filtrar por contenido
      <input autoFocus={!positionColumn} role="combobox" aria-label={'Filtrar '+label} autoComplete="off" aria-autocomplete="list" aria-expanded={suggestions.length>0} aria-controls={listId} aria-activedescendant={highlight>=0?listId+'-'+highlight:undefined} placeholder={numeric?'Ej. =10, >0':column==='loaded'?'Posición o contenedor…':'Escribí para buscar…'} value={value} onChange={event=>onFilter(event.target.value)} onKeyDown={keyDown}/>
    </label>
    {numeric&&<small className="filter-hint">Cantidad exacta o comparación: =10, &gt;0, &lt;=100.</small>}
    <small className="suggestion-label">Sugerencias</small>
    <div className="filter-suggestions" role="listbox" id={listId} aria-label={'Sugerencias de '+label}>
      {suggestions.map((option,index)=><button type="button" role="option" aria-selected={highlight===index} id={listId+'-'+index} key={option} onClick={()=>select(option)} title={option}>{option}</button>)}
    </div>
    {!suggestions.length&&<small className="filter-hint">Sin sugerencias para este contenido.</small>}
  </>;
  return <div className={'header-popover '+(positionColumn?'position-popover':'')}>
    <strong>{label}</strong>
    <div className="sort-options">{[['asc',numeric?'De menor a mayor':'De A a Z','↑'],['desc',numeric?'De mayor a menor':'De Z a A','↓']].map(([direction,title,arrow])=><button key={direction} aria-pressed={sort?.key===column&&sort.direction===direction} onClick={()=>{onSort({key:column,direction});onClose();}}><span aria-hidden="true">{arrow}</span>{title}</button>)}</div>
    {positionColumn&&<AislePicker rows={rows} column={column} selected={selectedAisles} onChange={onAisles}/>}
    {positionColumn?<details className="position-content-filter" open={!!value}><summary>{column==='loaded'?'Filtrar posición o contenedor':'Filtrar posición por contenido'}{value?' · '+value:''}</summary>{content}</details>:content}
    <button className="remove-column-filter" onClick={()=>{onFilter('');if(positionColumn)onAisles([]);onClose();}}>Quitar filtro</button>
    {sort?.key===column&&<button className="remove-column-sort" onClick={()=>{onSort(null);onClose();}}>Quitar orden</button>}
  </div>;
}

function AislePicker({rows,column,selected,onChange}) {
  const [search,setSearch]=useState(''),source=column==='original'?'Octosis':'WMS';
  const options=useMemo(()=>[...new Set([...aisleOptions(rows,column),...selected])].sort((a,b)=>a.localeCompare(b,'es',{numeric:true})),[rows,column,selected]);
  const visible=options.filter(aisle=>aisle.includes(search.trim().toUpperCase()));
  function toggle(aisle) {onChange(selected.includes(aisle)?selected.filter(value=>value!==aisle):[...selected,aisle].sort((a,b)=>a.localeCompare(b,'es',{numeric:true})));}
  return <fieldset className="aisle-picker"><legend>Pasillos · {source}</legend>
    <input autoFocus aria-label={'Buscar pasillos de '+source} placeholder="Buscar pasillo, ej. 2B" value={search} onChange={event=>setSearch(event.target.value)}/>
    <div className="aisle-options" role="group" aria-label={'Seleccionar pasillos de '+source}>
      {visible.map(aisle=><label className="aisle-option" key={aisle}><input type="checkbox" aria-label={'Pasillo '+source+' '+aisle} checked={selected.includes(aisle)} onChange={()=>toggle(aisle)}/><span>{aisle}</span></label>)}
      {!visible.length&&<small className="filter-hint">No hay pasillos para esta búsqueda.</small>}
    </div>
    <div className="aisle-picker-footer"><small>{selected.length?selected.length+' seleccionados':'Todos los pasillos'}</small><button type="button" disabled={!selected.length} onClick={()=>onChange([])}>Limpiar selección</button></div>
  </fieldset>;
}
