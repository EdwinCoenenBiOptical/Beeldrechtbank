'use client';
import {useEffect,useState} from 'react';
type Item={id:string;drawing_title_snapshot:string;purpose_name_snapshot:string;amount_cents:number;vat_percent:number;vat_cents:number;total_cents:number;currency:string;agreement_text_snapshot:string};
type Order={id:string;order_number:number;accepted_at:string;is_test:boolean;ordered_by_you:boolean;order_items:Item[]};
type History={orders:Order[];page:number;has_more:boolean};
const money=(cents:number,currency:string)=>new Intl.NumberFormat('nl-NL',{style:'currency',currency}).format(cents/100);
const date=(value:string)=>new Intl.DateTimeFormat('nl-NL',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Amsterdam'}).format(new Date(value));
export function OrderHistory(){
 const [page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[history,setHistory]=useState<History|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setHistory(null);setError('');
  fetch('/api/orders/history?page='+page,{cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);if(!controller.signal.aborted)setHistory(data)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'De bestellingen konden niet worden geladen.')}).finally(()=>{if(!controller.signal.aborted)setBusy(false)});
  return()=>controller.abort();
 },[page,refresh]);
 return <section className="order-history" aria-labelledby="history-title"><div className="toolbar"><h3 id="history-title">Bestellingen van jouw bedrijf</h3><button className="secondary" disabled={busy} onClick={()=>setRefresh(r=>r+1)}>Overzicht vernieuwen</button></div>
 <p className="muted">Hier vind je de bestellingen en gebruiksafspraken van jouw bedrijf, inclusief die van collega’s.</p>
 {busy&&<p role="status">Bestellingen laden…</p>}{error&&<p role="alert">{error}</p>}
 {history&&!history.orders.length&&<p className="status">Er zijn nog geen bestellingen om te tonen.</p>}
 {history?.orders.map(order=><article className="history-order panel" key={order.id}><div className="history-order-heading"><strong>{order.is_test?'Testbestelling':'Bestelling'} {order.order_number}</strong><span>{date(order.accepted_at)}</span></div><p className="tiny muted">{order.ordered_by_you?'Door jou besteld':'Door een collega besteld'}</p>
 {order.order_items.map(item=><div className="history-item" key={item.id}><h4>{item.drawing_title_snapshot}</h4><p>{item.purpose_name_snapshot} · Herhaald gebruik door hetzelfde bedrijf</p><dl className="order-totals"><div><dt>Exclusief btw</dt><dd>{money(item.amount_cents,item.currency)}</dd></div><div><dt>Btw ({item.vat_percent}%)</dt><dd>{money(item.vat_cents,item.currency)}</dd></div><div><dt>Totaal inclusief btw</dt><dd><strong>{money(item.total_cents,item.currency)}</strong></dd></div></dl><details><summary>Bekijk de akkoordverklaring</summary><p>{item.agreement_text_snapshot}</p></details></div>)}
 {order.is_test&&<p className="notice">Testbestelling · Er wordt geen factuur verstuurd.</p>}</article>)}
 {history&&(page>1||history.has_more)&&<div className="history-pagination"><button className="secondary" disabled={page===1||busy} onClick={()=>setPage(p=>p-1)}>Vorige</button><span>Pagina {page}</span><button className="secondary" disabled={!history.has_more||busy} onClick={()=>setPage(p=>p+1)}>Volgende</button></div>}
 <h3>Downloadgeschiedenis</h3><p className="status">Originele bestanden downloaden is nog niet beschikbaar. Zodra dit is aangesloten, verschijnen je downloads hier.</p>
 </section>
}
