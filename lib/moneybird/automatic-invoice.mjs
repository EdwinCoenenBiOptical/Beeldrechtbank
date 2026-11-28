import {buildOrderInvoicePlan,runOrderInvoice} from './order-invoices.mjs';
import {invoiceRecipient} from './contacts.mjs';
import {validateInvoice,issuedInvoice,InvoiceWriteError} from './invoices.mjs';
/** Never blind-retry a possibly successful send. All writes have a durable pre-write fence. */
export async function processAutomaticInvoice({source,job,client,contacts,repository,automation,administrationId}){
 if(source.order?.is_test!==false)throw Error('ORDER_INVOICE_REAL_ONLY');
 if(!source.link||source.link.administration_id!==administrationId)throw Error('ORDER_INVOICE_CONTACT');
 const contact=await contacts.contact(source.link.contact_id);
 const recipient=invoiceRecipient(contact,source.link.recipient_snapshot?.id||null);
 let plan=job.request_snapshot;
 if(!job.invoice_id&&['queued','prepared','create_rejected'].includes(job.status)){
  plan={...buildOrderInvoicePlan(source,contact,recipient,await client.options()),workflow_id:contact.invoice_workflow_id||null};
 }
 if(!plan)throw Error('ORDER_INVOICE_NOT_PREPARED');
 // Recover/validate drafts using the existing single-creation database state machine.
 job=await runOrderInvoice({intent:job.invoice_id||['creating','create_uncertain','blocked'].includes(job.status)?'check':'create',repository,client,plan});
 const invoice=await client.get(job.invoice_id);validateInvoice(invoice,job.request_snapshot);
 if(invoice.sent_at){await automation('sent',{invoice});return {sent:true,recovered:true};}
 // An issued/scheduled invoice is never re-sent automatically, even when sent_at is absent.
 if(issuedInvoice(invoice)||job.ever_issued)throw Error('INVOICE_DELIVERY_NOT_CONFIRMED');
 if(['sending','uncertain','blocked','sent'].includes(job.delivery_state))throw Error('INVOICE_SEND_UNCERTAIN');
 if(invoice.state!=='draft')throw Error('ORDER_INVOICE_MISMATCH');
 const deliveryContact=await contacts.contact(source.link.contact_id),deliveryRecipient=invoiceRecipient(deliveryContact,source.link.recipient_snapshot?.id||null);
 if(deliveryContact.id!==job.request_snapshot.contact_id||deliveryContact.country!=='NL'||deliveryContact.kvk.replace(/\D/g,'')!==source.company.kvk_number||!deliveryContact.address1||!deliveryContact.zipcode||!deliveryContact.city||deliveryContact.address!==job.request_snapshot.contact_address)throw Error('INVOICE_CONTACT');
 if(deliveryRecipient.email?.trim().toLowerCase()!==job.request_snapshot.recipient_email||deliveryRecipient.id!==job.request_snapshot.contact_person_id||(deliveryContact.invoice_workflow_id||null)!==(job.request_snapshot.workflow_id||null))throw Error('INVOICE_DELIVERY_SETTINGS_CHANGED');
 // Refresh the company link, connection and master switch in the database immediately before PATCH.
 await automation('sending',{invoice});
 try{await client.sendRegular(invoice.id,job.request_snapshot.recipient_email);}
 catch(error){
  await automation(error instanceof InvoiceWriteError&&!error.uncertain?'send_rejected':'send_uncertain');
  throw error;
 }
 // Keep the fence if readback fails, times out or still returns a draft.
 const sent=await client.get(invoice.id);validateInvoice(sent,job.request_snapshot);
 if(!sent.sent_at){await automation('send_uncertain');throw Error('INVOICE_SEND_UNCERTAIN');}
 await automation('sent',{invoice:sent});return {sent:true,recovered:false};
}
