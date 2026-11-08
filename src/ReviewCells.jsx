import React from 'react';
import {isResolved} from './domain.js';

const number=value=>(value>0?'+':'')+new Intl.NumberFormat('es-AR',{maximumFractionDigits:3}).format(value);
const date=value=>new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Argentina/Buenos_Aires'}).format(new Date(value));

export function DeltaValue({row}) {
  return <><strong className={isResolved(row)?'green':row.needsAnalysis?'amber':''}>{number(row.pendingDelta)}</strong>{row.needsAnalysis&&row.pendingDelta===0&&<small className="pending-control">Ver control</small>}{row.acceptedDifference&&<small className="accepted-delta">Diferencia aceptada: {number(row.delta)}</small>}</>;
}

export function ControlCell({row,onOpen}) {
  return <div className="control-cell">
    {isResolved(row)?<span className="tag success">{row.observation}</span>:<div className="review-issues">{(row.issues.length?row.issues:['Por revisar']).map(issue=><span key={issue} className="tag warning">{issue}</span>)}</div>}
    {row.review?.note&&<button className="note-preview" onClick={onOpen} title={row.review.note.text}><span>Mensaje para análisis</span><p>{row.review.note.text}</p></button>}
  </div>;
}

export function ReviewOutcome({row}) {
  if(!isResolved(row))return null;
  return <section className="review-outcome" aria-label="Resultado de la revisión">
    <strong>{row.autoResolved?'Resuelto automáticamente':row.observation}</strong>
    <p>{row.autoResolved?'La cantidad y la ubicación coinciden. El caso no requiere una aceptación manual.':row.acceptedDifference?'Caso resuelto. La diferencia de stock fue aceptada y no queda pendiente de revisión.':'Caso resuelto. La observación ya fue aceptada.'}</p>
    {row.review.updatedBy&&<small>{row.review.updatedBy}{row.review.updatedAt?' · '+date(row.review.updatedAt):''}</small>}
    {row.review.reason&&<p className="accepted-reason">Motivo: {row.review.reason}</p>}
  </section>;
}
