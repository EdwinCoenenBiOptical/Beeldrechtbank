"use client";
import {useEffect,useState} from 'react';
import {readApiResponse} from '../lib/http/api-response.mjs';
type Settings={enabled:boolean;activated_at:string|null;last_run_at:string|null;notification_email:string};
export function InvoiceAutomation(){
 const [settings,setSettings]=useState<Settings|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[checked,setChecked]=useState(false),[version,setVersion]=useState(0);
 useEffect(()=>{const c=new AbortController();setLoading(true);fetch('/api/admin/invoice-automation',{cache:'no-store',signal:c.signal}).then(async r=>{
  const d=await readApiResponse(r);if(!r.ok)throw Error(d.error||'Automatische facturatie is nog niet ingericht. Controleer SQL-script 022.');if(!c.signal.aborted){setSettings(d);setError('');}
 }).catch(e=>{if(!c.signal.aborted)setError(e.message)}).finally(()=>{if(!c.signal.aborted)setLoading(false)});return()=>c.abort()},[version]);
 async function configure(){
  if(!settings)return;setBusy(true);setError('');
  try{const r=await fetch('/api/admin/invoice-automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'configure',enabled:!settings.enabled,confirmed:true})});const d=await readApiResponse(r,{mutation:true});if(!r.ok)throw Error(d.error||'Opslaan is niet gelukt.');setSettings(d);setChecked(false);window.dispatchEvent(new Event('invoice-automation-changed'));}
  catch(e){setError(e instanceof Error?e.message:'Controleer de instelling opnieuw.');}finally{setBusy(false)}
 }
 return <section className="panel invoice-automation" aria-labelledby="automation-title">
  <h3 id="automation-title">Automatische facturatie {settings?settings.enabled?'· Aan':'· Uit':''}</h3>
  <p>Per nieuwe bestelling één factuur, automatisch aangemaakt en direct per e-mail verstuurd vanuit Moneybird. De betalingstermijn volgt de Moneybird-instellingen van het contact.</p>
  <p className="tiny muted">Alleen nieuwe bestellingen na de eerste inschakeling. Eerdere bestellingen en testbestellingen worden niet meegenomen. Opnieuw downloaden maakt geen factuur. Bij storingen gaat een melding naar info@rechtbanktekeningen.nl.</p>
  {settings?.enabled&&<p className="status">Verwerking gebeurt iedere vijf minuten. Pauzeren stopt volgende acties; een reeds lopende verzending kan nog worden afgerond.</p>}
  {settings&&!settings.enabled&&<label className="consent"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/><span>Ik wil nieuwe bestellingen automatisch factureren en direct laten versturen naar het factuuradres van het gekoppelde Moneybird-contact. Ik heb de klantkoppelingen en betaalinstellingen gecontroleerd.</span></label>}
  {settings&&<button className={settings.enabled?'secondary':'primary'} disabled={busy||loading||!settings.enabled&&!checked} onClick={configure}>{busy?'Opslaan…':settings.enabled?'Automatische facturatie pauzeren':'Inschakelen en direct versturen'}</button>}
  {' '}<button className="secondary" disabled={busy||loading} onClick={()=>setVersion(v=>v+1)}>Instelling vernieuwen</button>
  {settings?.last_run_at&&<p className="tiny muted">Laatste controle: {new Date(settings.last_run_at).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'})}</p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
