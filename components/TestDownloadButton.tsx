'use client';
import {useState} from 'react';
export function TestDownloadButton({purposeId}:{purposeId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function download(){setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/downloads/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose_id:purposeId})});if(!response.ok){const result=await response.json();throw Error(result.error)}const blob=await response.blob(),url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='NVH-001.jpg';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);setMessage('Het testbestand is aangeboden aan je browser. Je vindt de registratie in Mijn account.')}catch(e){setError(e instanceof Error?e.message:'De testdownload is niet gelukt.')}finally{setBusy(false)}}
 return <div><p className="tiny muted">Alleen voor de beheerder: deze testdownload haalt het gekoppelde JPEG-bestand uit Nicole’s OneDrive op.</p><button className="primary full" disabled={busy} onClick={download}>{busy?'Bestand ophalen…':'Testbestand downloaden'}</button>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}</div>
}
