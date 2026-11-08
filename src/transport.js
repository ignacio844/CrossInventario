const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

export async function fetchJson(url,options,{idempotent=false,onWait,sleep=pause,random=Math.random}={}) {
  const attempts=8;
  for(let attempt=0;attempt<attempts;attempt++){
    let result,error;
    try {
      const response=await fetch(url,options);
      try {result=await response.json();}
      catch {throw Object.assign(new Error('El servidor no pudo confirmar la operación. Tu texto se conserva.'),{status:502});}
      if(response.ok)return result;
      error=Object.assign(new Error(result.error||'No se pudo completar la operación. Tu texto se conserva.'),{status:response.status,code:result.code,retryAfterMs:result.retryAfterMs});
    }catch(failure){error=failure;}
    // A busy response has not written anything. Uncertain writes are retried only
    // when the caller supplies a stable operation ID that the server deduplicates.
    const retry=error.status===429||(idempotent&&(!error.status||[502,503,504].includes(error.status)));
    if(!retry||attempt===attempts-1)throw error;
    const delay=error.code==='SHEETS_QUOTA'?Math.max(1000,Math.min(Number(error.retryAfterMs)||65000,70000)):Math.min(500*2**attempt,5000)+Math.floor(random()*600);
    onWait?.(error.code==='SHEETS_QUOTA'?'Google Sheets está limitado temporalmente. Reintentando en '+Math.ceil(delay/1000)+' segundos. Tu texto se conserva.':'Hay otros guardados en curso. Reintentando '+(attempt+2)+' de '+attempts+'…');
    await sleep(delay);
  }
}

export function prepareAction(previous,body) {
  const key=value=>JSON.stringify({...value,requestId:undefined,expectedCaseVersion:value.action==='note'?undefined:value.expectedCaseVersion,expectedRevision:typeof value.expectedCaseVersion==='string'?undefined:value.expectedRevision});
  return previous&&key(previous)===key(body)?previous:{...body,requestId:crypto.randomUUID()};
}

export function isCurrentSnapshot(snapshot,currentRevision) {
  return currentRevision===undefined||snapshot.revision>=currentRevision;
}
