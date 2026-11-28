import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {moneybirdCredentials} from './credentials.mjs';
import {createMoneybirdInvoices} from './invoices.mjs';
import {createMoneybirdReader} from './contacts.mjs';
import {processAutomaticInvoice} from './automatic-invoice.mjs';
import {mailConfiguration,orderSender} from '../mail/order-confirmation.mjs';
import {rootnetTransport} from '../mail/transport.mjs';
export const invoiceAlertRecipient='info@rechtbanktekeningen.nl';
const safeCode=e=>e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'AUTOMATION_UNAVAILABLE';
export function automationRpc(client){
 /** @param {string} action @param {{actor?:string|null,order?:string|null,owner?:string|null,data?:any}} options */
 return async(action,{actor=null,order=null,owner=null,data={}}={})=>{
 const result=await client.rpc('server_invoice_automation',{p_action:action,p_actor_id:actor,p_order_id:order,p_owner:owner,p_data:data});
 if(result.error)throw Error(/^[A-Z_]+$/.test(result.error.message||'')?result.error.message:'AUTOMATION_DATABASE');
 return result.data;
};}
export async function runInvoiceAutomation({env=process.env,client,rpc,billing,sendAlert}={}){
 if(!rpc){
  const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw Error('AUTOMATION_SERVER_CONFIG');
  client??=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});rpc=automationRpc(client);
 }
 const owner=randomUUID(),job=await rpc('claim',{owner});
 let result={processed:0,sent:0,failed:0,alerts:0};
 if(job){
  const context={order:job.order_id,owner};
  try{
   if(job.source_error)throw Error(job.source_error);
   if(!billing){
    const oauthAction=async(actor,action,data={})=>{
     const r=await client.rpc('server_moneybird_oauth',{p_actor_id:actor,p_action:action,p_data:data});
     if(r.error)throw Error('MONEYBIRD_RECONNECT');return r.data;
    };
    const credentials=await moneybirdCredentials(job.actor_id,oauthAction,env);
    if(credentials.administrationId!==job.administration_id)throw Error('AUTOMATION_ADMINISTRATION_CHANGED');
    billing={client:createMoneybirdInvoices(credentials),contacts:createMoneybirdReader(credentials)};
   }
   await processAutomaticInvoice({source:job.source,job:job.job,client:billing.client,contacts:billing.contacts,administrationId:job.administration_id,
    repository:(action,data={})=>rpc('step',{...context,data:{action,data}}),
    automation:(action,data={})=>rpc(action,{...context,data})});
   result.sent++;
  }catch(error){result.failed++;await rpc('error',{...context,data:{code:safeCode(error)}});}
  finally{result.processed++;await rpc('release',context).catch(()=>{});}
 }
 // Separate durable alert state: one automatic SMTP attempt per distinct order/error.
 // A broken SMTP connection is visible in the portal and is never treated as delivered.
 const alert=await rpc('claim_alert',{owner});
 if(alert){
  let accepted=false;
  try{
   const message={from:orderSender,to:invoiceAlertRecipient,subject:`Beeldrechtbank: facturatie bestelling ${alert.order_number} controleren`,messageId:`<invoice-alert-${alert.order_id}-${alert.error}@beeldrechtbank.nl>`,text:[
    `Automatische facturatie voor bestelling ${alert.order_number} vraagt aandacht.`,
    `Foutcode: ${alert.error}`,'',
    'Bekijk Mijn account → Beheer → Facturen op https://www.beeldrechtbank.nl/#facturatie.',
    'Controleer eerst de bestaande factuur en de verzendstatus in Moneybird. Maak of verstuur geen tweede factuur wanneer de eerdere uitkomst onzeker is.',
    'Ontbrekende klantkoppelingen of factuuradressen kun je herstellen via Bedrijven & Moneybird.',
    'De bestelling en het gebruiksrecht blijven bewaard.'
   ].join('\n')};
   if(sendAlert)accepted=await sendAlert(message);
   else{
    const transport=rootnetTransport(mailConfiguration(env));
    try{const response=await transport.sendMail(message);accepted=response.accepted?.some(a=>String(a).toLowerCase()===invoiceAlertRecipient)===true;}finally{transport.close();}
   }
  }catch{/* Never expose credentials/provider output in logs or customer responses. */}
  await rpc('finish_alert',{order:alert.order_id,owner,data:{accepted}});result.alerts=accepted?1:0;
 }
 return result;
}
