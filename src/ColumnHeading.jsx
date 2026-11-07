import React,{useEffect,useMemo,useState,useId} from 'react';
import {columnOptions,numericColumns,suggestValues} from './table.js';

export default function ColumnHeading({label,column,rows,value,onFilter,sort,onSort,open,onToggle,onClose}) {
  const numeric=numericColumns.has(column),sorted=sort?.key===column;
  return <th scope="col" className={'filter-heading '+(value||sorted?'filtered':'')} aria-sort={sorted?(sort.direction==='asc'?'ascending':'descending'):'none'}>
    <button className="filter-trigger" aria-label={'Abrir filtro de '+label} aria-expanded={open} onClick={onToggle}>
      <span>{label}{sorted&&<span className="sort-indicator" aria-hidden="true">{sort.direction==='asc'?' ↑':' ↓'}</span>}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8Z"/></svg>
    </button>
    {open&&<FilterMenu {...{label,column,rows,value,onFilter,sort,onSort,onClose,numeric}}/>}
  </th>;
}

function FilterMenu({label,column,rows,value,onFilter,sort,onSort,onClose,numeric}) {
  const listId=useId(),[highlight,setHighlight]=useState(-1);
  const options=useMemo(()=>columnOptions(rows,column),[rows,column]);
  const suggestions=useMemo(()=>suggestValues(options,value,column),[options,value,column]);
  useEffect(()=>setHighlight(-1),[value]);
  const select=value=>{onFilter(value);onClose();};
  function keyDown(event) {
    if(event.key==='ArrowDown'){event.preventDefault();setHighlight(previous=>Math.min(previous+1,suggestions.length-1));}
    if(event.key==='ArrowUp'){event.preventDefault();setHighlight(previous=>Math.max(previous-1,0));}
    if(event.key==='Enter'){event.preventDefault();if(highlight>=0&&suggestions[highlight]!==undefined)select(suggestions[highlight]);else onClose();}
  }
  return <div className="header-popover">
    <strong>{label}</strong>
    <div className="sort-options">{[['asc',numeric?'De menor a mayor':'De A a Z','↑'],['desc',numeric?'De mayor a menor':'De Z a A','↓']].map(([direction,title,arrow])=><button key={direction} aria-pressed={sort?.key===column&&sort.direction===direction} onClick={()=>{onSort({key:column,direction});onClose();}}><span aria-hidden="true">{arrow}</span>{title}</button>)}</div>
    <label className="filter-content-label">Filtrar por contenido
      <input autoFocus role="combobox" aria-label={'Filtrar '+label} autoComplete="off" aria-autocomplete="list" aria-expanded={suggestions.length>0} aria-controls={listId} aria-activedescendant={highlight>=0?listId+'-'+highlight:undefined} placeholder={numeric?'Ej. =10, >0':'Escribí para buscar…'} value={value} onChange={event=>onFilter(event.target.value)} onKeyDown={keyDown}/>
    </label>
    {numeric&&<small className="filter-hint">Cantidad exacta o comparación: =10, &gt;0, &lt;=100.</small>}
    <small className="suggestion-label">Sugerencias</small>
    <div className="filter-suggestions" role="listbox" id={listId} aria-label={'Sugerencias de '+label}>
      {suggestions.map((option,index)=><button type="button" role="option" aria-selected={highlight===index} id={listId+'-'+index} key={option} onClick={()=>select(option)} title={option}>{option}</button>)}
    </div>
    {!suggestions.length&&<small className="filter-hint">Sin sugerencias para este contenido.</small>}
    <button className="remove-column-filter" onClick={()=>{onFilter('');onClose();}}>Quitar filtro</button>
    {sort?.key===column&&<button className="remove-column-sort" onClick={()=>{onSort(null);onClose();}}>Quitar orden</button>}
  </div>;
}
