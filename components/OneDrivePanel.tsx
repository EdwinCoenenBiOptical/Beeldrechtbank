'use client';
import {useEffect,useState} from 'react';
type Metadata={accountName:string;fileName:string;size:number;path:string;verifiedAt:string};
export function OneDrivePanel(){
 const [metadata,setMetadata]=useState<Metadata|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const controller=new AbortController();
 const result=new URLSearchParams(location.search).get('onedrive');
 const messages:Record<string,string>={connected:'De OneDrive-koppeling is opgeslagen.',cancelled:'De Microsoft-toestemming is geannuleerd.',invalid:'De koppellink is verlopen of ongeldig. Start opnieuw.',file_missing:'Het testbestand is niet gevonden. Kies Nicole’s account en controleer het bestandspad.',microsoft_error:'Microsoft kon de verbinding niet bevestigen. Controleer de appregistratie.',failed:'De verbinding kon niet worden opgeslagen. Controleer de instellingen en probeer opnieuw.'};
 if(result)setMessage(messages[result]||'Controleer de koppeling.');
 fetch('/api/onedrive/status',{cache:'no-store',signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(!controller.signal.aborted)setMetadata(data.metadata)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
 return()=>controller.abort();},[]);
 async function test(){setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/onedrive/test',{method:'POST'});const result=await response.json();if(!response.ok)throw Error(result.error);setMetadata(result.metadata);setMessage('Het testbestand is bereikbaar via Microsoft Graph.')}catch(e){setError(e instanceof Error?e.message:'De verbinding kon niet worden gecontroleerd.')}finally{setBusy(false)}}
 return <section className="panel onedrive-panel"><div className="eyebrow">Beheer · Bestandsopslag</div><h3>OneDrive verbinden</h3><p>Start de koppeling terwijl je als beheerder bent ingelogd. Kies daarna Nicole’s persoonlijke Microsoft-account om toegang te geven tot haar tekeningen.</p>{message&&<p className="status" role="status">{message}</p>}{error&&<p role="alert">{error}</p>}{metadata&&<><p><strong>Verbonden account:</strong> {metadata.accountName}</p><p><strong>Testbestand:</strong> {metadata.path}<br/>{(metadata.size/1000000).toLocaleString('nl-NL',{maximumFractionDigits:2})} MB</p><p className="tiny muted">Controleer dat dit Nicole’s account is. Downloaden voor redacties is nog niet ingeschakeld.</p><button className="secondary" disabled={busy} onClick={test}>{busy?'Controleren…':'Testbestand controleren'}</button></>}
 <form method="post" action="/api/onedrive/connect"><button className="primary" disabled={busy}>{metadata?'OneDrive opnieuw verbinden':'OneDrive verbinden'}</button></form>
 </section>
}
