import React from 'react';
import './wms-stock.css';

const amount=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:3}).format(value);

export default function WmsStock({row,showContainers=true}){
 if(!row.wmsPresent)return <>—<small className="stock-absence">{row.otherWms?.length?'En otra posición':'No figura en esta descarga'}</small></>;
 if(!row.wmsStockLines.length)return <>{amount(row.wmsQty)}</>;
 const multiplePositions=row.loadedLocations.length>1;
 return <div className={'wms-stock'+(showContainers?'':' quantities-only')} aria-label="Stock WMS por contenedor">
  <div className="wms-stock-lines">{row.wmsStockLines.map(line=><div className="wms-stock-line" key={JSON.stringify([line.position,line.container])}>
   {showContainers&&<span title={line.position}>{multiplePositions&&<small>{line.position}</small>}{line.container||'Sin contenedor'}</span>}<strong>{amount(line.quantity)}</strong>
  </div>)}</div>
  {row.wmsStockLines.length>1&&<small className="wms-stock-total">Total WMS: <b>{amount(row.wmsQty)}</b></small>}
 </div>;
}
