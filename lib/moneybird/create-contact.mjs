import {MoneybirdError,contactSummary} from './contacts.mjs';
const fields={address1:200,address2:200,zipcode:20,city:100,country:2,invoice_email:254,invoice_attention:150};
export function contactDraft(company,input){
 if(!company||typeof company.name!=='string'||!company.name.trim()||company.name.length>200||!/^\d{8}$/.test(company.kvk_number))throw new MoneybirdError('CONTACT_INPUT');
 if(!input||typeof input!=='object'||Array.isArray(input))throw new MoneybirdError('CONTACT_INPUT');
 const draft={company_name:company.name.trim(),chamber_of_commerce:company.kvk_number};
 for(const [field,max] of Object.entries(fields)){
  if(input[field]!=null&&typeof input[field]!=='string')throw new MoneybirdError('CONTACT_INPUT');
  const value=(input[field]||'').trim();if(value.length>max||/[\r\n\u0000]/.test(value))throw new MoneybirdError('CONTACT_INPUT');draft[field]=value;
 }
 draft.country=draft.country.toUpperCase();draft.zipcode=draft.zipcode.toUpperCase();
 if(!draft.address1||!draft.city||!draft.zipcode||!/^[A-Z]{2}$/.test(draft.country)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.invoice_email))throw new MoneybirdError('CONTACT_INPUT');
 if(draft.country==='NL'&&!/^[1-9][0-9]{3}\s?[A-Z]{2}$/.test(draft.zipcode))throw new MoneybirdError('CONTACT_INPUT');
 return draft;
}
export class ContactWriteError extends MoneybirdError {constructor(code,uncertain){super(code);this.uncertain=uncertain}}
export function createMoneybirdContactWriter({token,administrationId},request=fetch){
 if(!token||!/^\d{1,40}$/.test(administrationId||''))throw new MoneybirdError('MONEYBIRD_CONFIG');
 return {async create(draft,customerId){
  if(!/^BRB-[0-9a-f-]{36}$/.test(customerId))throw new MoneybirdError('CONTACT_INPUT');
  const contact={company_name:draft.company_name,chamber_of_commerce:draft.chamber_of_commerce,address1:draft.address1,address2:draft.address2,zipcode:draft.zipcode,city:draft.city,country:draft.country,email:draft.invoice_email,send_invoices_to_email:draft.invoice_email,send_invoices_to_attention:draft.invoice_attention,customer_id:customerId};
  let response;try{response=await request(`https://moneybird.com/api/v2/${administrationId}/contacts.json`,{method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({contact}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)})}catch{throw new ContactWriteError('CONTACT_CREATE_UNCERTAIN',true)}
  if(!response.ok){const rejected=[400,401,403,404,422,429].includes(response.status);throw new ContactWriteError(response.status===422||response.status===400?'CONTACT_PROVIDER_VALIDATION':response.status===401||response.status===403?'MONEYBIRD_ACCESS':response.status===429?'MONEYBIRD_RATE_LIMIT':'CONTACT_CREATE_UNCERTAIN',!rejected)}
  try{return contactSummary(await response.json())}catch{throw new ContactWriteError('CONTACT_CREATE_UNCERTAIN',true)}
 }};
}
export async function existingKvkContacts(reader,kvk){
 const matches=[];
 for(let page=1;page<=100;page++){
  const data=await reader.search(kvk,page);
  matches.push(...data.contacts.filter(c=>c.kvk.replace(/\D/g,'')===kvk));
  if(!data.has_more)return matches;
 }
 throw new MoneybirdError('CONTACT_SEARCH_INCOMPLETE');
}
// Repository actions are server-only DB calls; writer is invoked at most once after durable 'sending'.
export async function runContactCreation({repository,reader,writer,draft,resume=false}){
 const reserved=await repository('reserve',{draft,resume});
 if(!reserved.acquired)throw new MoneybirdError('CONTACT_CREATE_BUSY');
 let job=reserved.job;
 try{
  let contact=await reader.byCustomerId(job.customer_id);
  if(!contact&&job.contact_id)contact=await reader.contact(job.contact_id);
  if(!contact){
   if(resume||['sending','uncertain','created'].includes(job.status))throw new MoneybirdError('CONTACT_CREATE_UNCERTAIN');
   const matches=await existingKvkContacts(reader,job.request_snapshot.chamber_of_commerce);
   if(matches.length){const error=new MoneybirdError('CONTACT_ALREADY_EXISTS');error.contacts=matches;throw error}
   await repository('sending');
   try{contact=await writer.create(job.request_snapshot,job.customer_id)}catch(error){
    await repository(error instanceof ContactWriteError&&!error.uncertain?'rejected':'uncertain',{error:error instanceof ContactWriteError?error.message:'CONTACT_CREATE_UNCERTAIN'});
    throw error;
   }
  }
  // A stable customer ID is owned by this portalcompany; a different KvK needs manual investigation.
  if(contact.kvk.replace(/\D/g,'')!==job.request_snapshot.chamber_of_commerce||!job.contact_id&&contact.customer_id!==job.customer_id)throw new MoneybirdError('CONTACT_CREATED_MISMATCH');
  await repository('created',{contact});
  return await repository('link',{contact});
 }finally{await repository('release').catch(()=>{})}
}
