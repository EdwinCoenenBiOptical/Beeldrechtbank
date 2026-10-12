'use client';
import {useEffect,useState,useRef} from 'react';
import {confirmationToken} from '../../../lib/auth/confirmation.mjs';
export default function ConfirmEmail(){
 const initialized=useRef(false);
 const [token,setToken]=useState<string|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(initialized.current)return;initialized.current=true;setToken(confirmationToken(location.hash));history.replaceState(null,'','/auth/confirm');setReady(true)},[]);
 async function confirm(){if(!token||busy)return;setBusy(true);setError('');try{const response=await fetch('/api/auth/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token_hash:token})});const result=await response.json();if(!response.ok)throw Error(result.error);setConfirmed(true);setToken(null)}catch(e){setError(e instanceof Error?e.message:'Bevestigen is niet gelukt.')}finally{setBusy(false)}}
 return <main className="wrap"><section className="pagehead"><div className="eyebrow">Beeldrechtbank</div><h2>{confirmed?'E-mailadres bevestigd':'Bevestig je e-mailadres'}</h2>{!ready?<p role="status">Even geduld…</p>:confirmed?<><p role="status">Je e-mailadres is bevestigd. Log in met het e-mailadres en wachtwoord van je aanmelding. Je aanvraag blijft wachten op goedkeuring.</p><a className="primary" href="/#inloggen">Naar inloggen →</a></>:token?<><p>Klik hieronder om het e-mailadres van je aanmelding te bevestigen. Daarna kun je inloggen.</p><button className="primary" disabled={busy} onClick={confirm}>{busy?'Bevestigen…':'E-mailadres bevestigen'}</button></>:<><p>Deze bevestigingslink is onvolledig of is al geopend. Probeer in te loggen; als dat niet lukt kun je een nieuwe bevestigingsmail aanvragen.</p><a className="primary" href="/#inloggen">Naar inloggen →</a></>}{error&&<p role="alert">{error}</p>}</section></main>
}
