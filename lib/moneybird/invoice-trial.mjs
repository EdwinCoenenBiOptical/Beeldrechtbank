import {MoneybirdError} from './contacts.mjs';
import {validateInvoice,issuedInvoice,fingerprint,InvoiceWriteError} from './invoices.mjs';
async function inspect(repository,client,job){
 const invoice=await client.get(job.invoice_id);let valid=true;
 try{validateInvoice(invoice,job.request_snapshot);if(invoice.state!=='draft'&&!issuedInvoice(invoice))valid=false}catch{valid=false}
 const updated=await repository('verified',{invoice,valid,issued:issuedInvoice(invoice),review_hash:fingerprint(invoice)});
 if(!valid)throw new MoneybirdError('INVOICE_MISMATCH');return updated;
}
/** @param {{intent:string, repository:Function, client:any, plan?:any, expectedReview?:string|null}} options */
export async function runInvoiceTrial({intent,repository,client,plan=null,expectedReview=null}){
 const reserved=await repository('reserve',{intent,plan});if(!reserved.acquired)throw new MoneybirdError('INVOICE_BUSY');let job=reserved.job;
 try{
  if(!job.invoice_id){
   const existing=job.request_snapshot.internal_reference?await client.findForPlan(job.request_snapshot):await client.findReference(job.reference);
   if(existing)job=await repository('record',{invoice_id:existing});
   else{
    if(intent!=='create'||!['prepared','create_rejected'].includes(job.status))throw new MoneybirdError('INVOICE_WRITE_UNCERTAIN');
    await repository('creating');let id;
    try{id=await client.create(job.request_snapshot)}catch(error){await repository(error instanceof InvoiceWriteError&&!error.uncertain?'rejected':'uncertain',{phase:'create',error:error instanceof Error?error.message:'INVOICE_WRITE_UNCERTAIN'});throw error}
    job=await repository('record',{invoice_id:id});
   }
  }
  const checked=await inspect(repository,client,job);
  if(intent!=='send')return checked;
  if(checked.sent_at||checked.status==='sent')return checked;
  if(checked.status!=='draft'||checked.send_unresolved)throw new MoneybirdError('INVOICE_SEND_UNCERTAIN');
  if(!expectedReview||expectedReview!==checked.review_hash)throw new MoneybirdError('INVOICE_REVIEW_CHANGED');
  await repository('sending',{review_hash:expectedReview});
  try{await client.send(checked.invoice_id,checked.request_snapshot.recipient_email)}catch(error){await repository(error instanceof InvoiceWriteError&&!error.uncertain?'rejected':'uncertain',{phase:'send',error:error instanceof Error?error.message:'INVOICE_WRITE_UNCERTAIN'});throw error}
  try{return await inspect(repository,client,checked)}catch(error){await repository('uncertain',{phase:'send',error:'INVOICE_SEND_UNCERTAIN'}).catch(()=>{});throw error}
 }finally{await repository('release').catch(()=>{})}
}
