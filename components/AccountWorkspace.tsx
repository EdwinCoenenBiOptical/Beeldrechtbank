"use client";
import { useEffect, useState } from 'react';
import type { Drawing } from '../lib/catalogue/types';
import { readApiResponse } from '../lib/http/api-response.mjs';
import { AccountPanel } from './AccountPanel';
import { OrderHistory } from './OrderHistory';
import { DownloadHistory } from './DownloadHistory';
import { AdminApplications } from './AdminApplications';
import { MoneybirdCompanies } from './MoneybirdCompanies';
import { OrderInvoiceAdmin } from './OrderInvoiceAdmin';
import { OneDrivePanel } from './OneDrivePanel';
import { CatalogueAdmin } from './CatalogueAdmin';
import { OrderMailAdmin } from './OrderMailAdmin';
import { MoneybirdInvoiceTrial } from './MoneybirdInvoiceTrial';
const personal = [['account','Accountinformatie'],['bestellingen','Bestellingen'],['downloads','Downloads']];
const management = [['beheer','Aanmeldingen'],['personen','Personen'],['bedrijven','Bedrijven & Moneybird'],['beheer-downloads','Downloads'],['beheer-bestellingen','Bestellingen'],['facturatie','Facturen'],['onedrive','OneDrive'],['catalogusbeheer','Catalogus']];
export const accountPages = [...personal,...management,['bestelmails','Bestelbevestigingen'],['factuurproef','Factuurproef']].map(([id])=>id);
export function AccountWorkspace({page,drawings}:{page:string;drawings:Drawing[]}) {
 const [account,setAccount]=useState<{is_onedrive_admin?:boolean;onedrive_admin_check_error?:string}|null>(null);
 const [error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setError('');
  fetch('/api/account',{cache:'no-store',signal:controller.signal}).then(async response=>{
   const data=await readApiResponse(response);if(!response.ok)throw Error(data.error||'Account laden is niet gelukt.');
   if(!controller.signal.aborted)setAccount(data);
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return()=>controller.abort();
 },[retry]);
 const admin=account?.is_onedrive_admin===true, personalPage=personal.some(([id])=>id===page);
 function links(items:string[][]){return items.map(([id,label])=><a key={id} href={'#'+id} aria-current={page===id?'page':undefined}>{label}</a>)}
 return <div className="account-workspace">
  <nav className="account-navigation" aria-label="Account en beheer">
   <div className="account-nav-group"><span className="account-nav-label">Mijn account</span><div>{links(personal)}</div></div>
   {admin&&<div className="account-nav-group"><span className="account-nav-label">Beheer</span><div>{links(management)}</div></div>}
  </nav>
  {error&&<p role="alert">{error} <button className="secondary" onClick={()=>setRetry(n=>n+1)}>Opnieuw proberen</button></p>}
  {!account&&!error&&<p role="status">Account laden…</p>}
  {account?.onedrive_admin_check_error&&<p role="alert">{account.onedrive_admin_check_error}</p>}
  {account&&(personalPage||admin)&&<div className="account-content" key={page}>
   {page==='account'&&<AccountPanel drawings={drawings}/>}
   {page==='bestellingen'&&<OrderHistory drawings={drawings}/>}
   {page==='downloads'&&<DownloadHistory drawings={drawings}/>}
   {page==='beheer'&&<AdminApplications/>}
   {page==='personen'&&<AdminApplications persons/>}
   {page==='bedrijven'&&<MoneybirdCompanies/>}
   {page==='beheer-bestellingen'&&<OrderHistory drawings={drawings} admin/>}
   {page==='beheer-downloads'&&<DownloadHistory drawings={drawings} admin/>}
   {page==='facturatie'&&<><OrderInvoiceAdmin/><details className="account-tools"><summary>Mailinstellingen en eerdere factuurproef</summary><p><a className="secondary" href="#bestelmails">Bestelbevestigingen</a> <a className="secondary" href="#factuurproef">Eerdere factuurproef</a></p></details></>}
   {page==='onedrive'&&<OneDrivePanel/>}
   {page==='catalogusbeheer'&&<CatalogueAdmin/>}
   {page==='bestelmails'&&<OrderMailAdmin/>}
   {page==='factuurproef'&&<MoneybirdInvoiceTrial/>}
  </div>}
  {account&&!personalPage&&!admin&&<section className="pagehead"><h2>Geen beheertoegang</h2><p>Dit onderdeel is alleen beschikbaar voor beheerders.</p><a href="#account" className="secondary">Naar mijn account</a></section>}
 </div>;
}
