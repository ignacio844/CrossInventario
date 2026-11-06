const key='escobar-google-session-v1';
export function restoreSession(storage,now=Date.now()){
 try{const value=JSON.parse(storage.getItem(key)||'null');return value&&typeof value.token==='string'&&value.token.startsWith('s1.')&&Number(value.expiresAt)>now?value:null;}catch{return null;}
}
export function saveSession(storage,session){storage.setItem(key,JSON.stringify({token:session.token,expiresAt:session.expiresAt}));}
export function clearSession(storage){storage.removeItem(key);}
