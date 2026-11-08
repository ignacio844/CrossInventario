import React from 'react';
import {isResolved} from './domain.js';

const amount=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:3}).format(value);
const number=value=>(value>0?'+':'')+new Intl.NumberFormat('es-AR',{maximumFractionDigits:3}).format(value);
const date=value=>new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Argentina/Buenos_Aires'}).format(new Date(value));

export function DeltaValue({row}) {
  return <><strong className={isResolved(row)?'green':row.needsAnalysis?'amber':''}>{number(row.pendingDelta)}</strong>{row.needsAnalysis&&row.pendingDelta===0&&<small className="pending-control">Ver control</small>}{row.acceptedDifference&&<small className="accepted-delta">Diferencia aceptada: {number(row.delta)}</small>}</>;
}

export function ControlCell({row,onOpen}) {
  return <div className="control-cell">
    {isResolved(row)?<span className="tag success">{row.observation}</span>:<div className="review-issues">{(row.issues.length?row.issues:['Por revisar']).map(issue=><span key={issue} className="tag warning">{issue}</span>)}</div>}
    {row.review?.note&&<button className="note-preview" onClick={onOpen} title={row.review.note.text}><span>Mensaje para análisis</span><p>{row.review.note.text}</p></button>}
    {row.review?.updatedAt&&<button className="saved-action-preview" onClick={onOpen}>Acción guardada · {date(row.review.updatedAt)}</button>}
  </div>;
}

export function LastSavedAction({row}) {
  const review=row.review;if(!review?.updatedAt)return null;
  const titles={'request-c2':'Solicitud a C2','record-c2':'Resultado de C2','accept':'Resultado aceptado','adjust':'Ajuste registrado','verify':'Ajuste verificado','reopen':'Revisión reabierta'};
  return <section className="last-saved-action" aria-label="Última acción guardada">
    <strong>Última acción guardada · {titles[review.lastAction]||review.status}</strong>
    <small>{review.updatedBy} · {date(review.updatedAt)}</small>
    {review.reason&&<p>{review.reason}</p>}
    {row.changed&&<p className="saved-action-explanation">La acción y su observación siguen guardadas. El stock cambió después y requiere otra revisión.</p>}
  </section>;
}

export function StockContext({row,meta,onOpen}) {
  const review=row.review,adjustment=review?.status==='Ajustado en WMS';
  const latest=meta.wmsCapturedAt||meta.importedAt;
  const waiting=meta.importId===review.adjustmentImportId||meta.wmsCapturedAt&&Date.parse(meta.wmsCapturedAt)<=Date.parse(review.adjustmentAt||review.updatedAt);
  return <section className="stock-context" aria-label="Estado de la descarga WMS">
    <small>{latest?'Última descarga WMS: '+date(latest):'Stock según la última descarga WMS disponible.'}</small>
    {adjustment&&<div className="adjustment-followup"><strong>Ajuste guardado: cantidad objetivo {amount(review.targetQuantity)}</strong><p>{waiting?'Esperando una descarga posterior al ajuste.':row.wmsQty===review.targetQuantity?'La última descarga coincide con la cantidad registrada. Podés verificar el ajuste.':'La última descarga todavía no confirma la cantidad objetivo.'}</p></div>}
    {!row.wmsPresent&&<p>{row.historicalOnly?'El caso y sus acciones se conservan, aunque el artículo ya no figure en las fuentes de stock.':'El artículo no figura en la última descarga para este grupo de posiciones.'} La ausencia en el reporte no borra el registro de revisión.</p>}
    {!row.wmsPresent&&row.otherWms?.length>0&&<div className="other-stock"><strong>Hay stock del artículo en otras posiciones WMS</strong>{row.otherWms.slice(0,4).map(other=><button key={other.id} onClick={()=>onOpen?.(other)}>{other.positions.join(' · ')} · {amount(other.quantity)} u.</button>)}{row.otherWms.length>4&&<small>Consultá el total del artículo para ver todas las posiciones.</small>}</div>}
  </section>;
}

export function ReviewOutcome({row}) {
  if(!isResolved(row))return null;
  return <section className="review-outcome" aria-label="Resultado de la revisión">
    <strong>{row.autoResolved?'Resuelto automáticamente':row.observation}</strong>
    <p>{row.autoResolved?'La cantidad y la ubicación coinciden. El caso no requiere una aceptación manual.':row.acceptedDifference?'Caso resuelto. La diferencia de stock fue aceptada y no queda pendiente de revisión.':'Caso resuelto. La observación ya fue aceptada.'}</p>
  </section>;
}
