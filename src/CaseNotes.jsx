import {prepareAction} from './transport.js';
import React,{useState,useRef} from 'react';
import * as api from './api.js';

const date=value=>new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Argentina/Buenos_Aires'}).format(new Date(value));

export default function CaseNotes({row,revision,onSave,onNotice}) {
  const attempt=useRef(null);
  const [waiting,setWaiting]=useState('');
  const [message,setMessage]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const note=row.review.note;
  async function save(event) {
    event.preventDefault();if(!message.trim())return;
    setSaving(true);setError('');setWaiting('');
    try {
      attempt.current=prepareAction(attempt.current,{id:row.id,action:'note',message,expectedRevision:revision,expectedCaseVersion:row.caseVersion});
      const result=await api.action(attempt.current,{onWait:setWaiting});
      onSave(result);attempt.current=null;setMessage('');onNotice('Mensaje guardado. El estado del caso se conserva.');
    } catch(error) {setError(error.message);}
    finally {setSaving(false);setWaiting('');}
  }
  return <section className="case-notes" aria-label="Mensajes para análisis o ajuste">
    <h3>Mensaje para análisis o ajuste <span>Opcional</span></h3>
    {note&&<div className="latest-case-note"><p>{note.text}</p><small>{note.by} · {note.role} · {date(note.at)}</small>{row.review.noteCount>1&&<small>Los mensajes anteriores se conservan en el historial.</small>}</div>}
    <details className="note-editor"><summary>{note?'Agregar otro mensaje':'Dejar un mensaje'}</summary>
      <form onSubmit={save}><label>Mensaje <span className="optional">· Opcional</span><textarea aria-label="Mensaje para análisis o ajuste (opcional)" rows={3} maxLength={2000} value={message} onChange={event=>setMessage(event.target.value)} placeholder="Qué se relevó y qué ajuste o control falta realizar."/></label>
        <p className="note-help">Guardar un mensaje no acepta ni cierra el caso.</p>
        {error&&<div className="error" role="alert">{error}</div>}
        {waiting&&<p className="save-waiting" role="status">{waiting}</p>}
        <button disabled={saving||!message.trim()}>{saving?'Guardando…':'Guardar mensaje'}</button>
      </form>
    </details>
  </section>;
}
