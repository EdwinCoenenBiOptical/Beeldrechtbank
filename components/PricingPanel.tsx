'use client';
import {useEffect,useState} from 'react';
import {browserClient} from '../lib/supabase/browser';
import {PurchasePanel} from './PurchasePanel';
import {supabaseConfig} from '../lib/supabase/config';
type Price={purpose_id:string;name:string;amount_cents:number|null;currency:string};
type Tariffs={company:{name:string;customer_number:number};prices:Price[]};
const money=(cents:number,currency:string)=>new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(cents/100);
export function PricingPanel({drawingKey}:{drawingKey:string}){
 const [data,setData]=useState<Tariffs|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[code,setCode]=useState(0);
 useEffect(()=>{
  let active=true;let generation=0;let controller:AbortController|undefined;
  async function load(){
   const requestGeneration=++generation;controller?.abort();controller=new AbortController();
   if(active){setBusy(true);setData(null);setError('');setCode(0)}
   try{const response=await fetch('/api/prices',{cache:'no-store',signal:controller.signal});const result=await response.json();if(!active||requestGeneration!==generation)return;if(!response.ok){setCode(response.status);setError(result.error);return}setData(result);setSelected(result.prices[0]?.purpose_id||'');}
   catch(e){if(active&&requestGeneration===generation&&!(e instanceof Error&&e.name==='AbortError'))setError('De tarieven konden niet worden opgehaald. Vernieuw de pagina om opnieuw te proberen.');}
   finally{if(active&&requestGeneration===generation)setBusy(false)}
  }
  void load();
  const subscription=supabaseConfig()?browserClient().auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='TOKEN_REFRESHED')void load();}).data.subscription:null;
  return()=>{active=false;controller?.abort();subscription?.unsubscribe()};
 },[]);
 const chosen=data?.prices.find(p=>p.purpose_id===selected);
 return <><h3>Gebruik & tarief</h3>{busy&&<p className="status" role="status">Bedrijfstarieven laden…</p>}
 {!data&&!busy&&<><p className="status" role="status">{error}</p>{code===401?<a className="primary full" href="#inloggen">Inloggen om je tarief te bekijken →</a>:<a className="secondary full" href="#account">Bekijk je accountstatus →</a>}</>}
 {data&&<><p className="tiny muted">Tarief voor {data.company.name} · Klant {data.company.customer_number}</p>
 {data.prices.map(p=><label className="license" key={p.purpose_id}><input type="radio" name="purpose" checked={selected===p.purpose_id} onChange={()=>setSelected(p.purpose_id)}/><span>{p.name}<small>Herhaald gebruik door hetzelfde bedrijf</small></span><b>{p.amount_cents===null?'Op aanvraag':money(p.amount_cents,p.currency)}</b></label>)}
 {!data.prices.length&&<p className="status">Er zijn nog geen gebruiksdoelen beschikbaar.</p>}
 {chosen&&chosen.amount_cents!==null?<><div className="price"><span>Tarief <small className="muted">excl. btw</small></span><b>{money(chosen.amount_cents,chosen.currency)}</b></div></>:chosen&&<p className="status">Voor {chosen.name} is nog geen bedrijfstarief ingesteld. Downloaden voor dit gebruiksdoel is niet beschikbaar.</p>}
 {chosen&&<PurchasePanel key={chosen.purpose_id} drawingKey={drawingKey} purposeId={chosen.purpose_id}/>}
 </>}
 <p className="tiny muted">Voor een download bevestig je de prijs, het gebruiksdoel en dat jouw bedrijf een factuur ontvangt. Facturatie gebeurt apart.</p></>
}
