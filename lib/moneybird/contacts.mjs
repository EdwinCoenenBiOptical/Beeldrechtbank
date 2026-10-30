// Moneybird IDs are decimal strings: never convert them to JS numbers.
export const moneybirdId=value=>typeof value==='string'&&/^[0-9]{1,40}$/.test(value);
export class MoneybirdError extends Error {}
const clean=value=>typeof value==='string'?value.trim():'';
export function contactSummary(raw){
 if(!raw||!moneybirdId(raw.id))throw new MoneybirdError('MONEYBIRD_RESPONSE');
 const people=Array.isArray(raw.contact_people)?raw.contact_people.filter(p=>moneybirdId(p.id)).map(p=>({id:p.id,name:[clean(p.firstname),clean(p.lastname)].filter(Boolean).join(' '),email:clean(p.email)})):[];
 return {id:raw.id,customer_id:clean(raw.customer_id),name:clean(raw.company_name)||[clean(raw.firstname),clean(raw.lastname)].filter(Boolean).join(' '),kvk:clean(raw.chamber_of_commerce),email:clean(raw.email),invoice_email:clean(raw.send_invoices_to_email)||clean(raw.email),attention:clean(raw.send_invoices_to_attention),address:[clean(raw.address1),clean(raw.address2),[clean(raw.zipcode),clean(raw.city)].filter(Boolean).join(' '),clean(raw.country)].filter(Boolean).join(', '),people};
}
export function invoiceRecipient(contact,personId){
 if(!personId)return {id:null,name:contact.attention||null,email:contact.invoice_email||null};
 const person=contact.people.find(p=>p.id===personId);
 if(!person)throw new MoneybirdError('MONEYBIRD_PERSON_MISSING');
 return {id:person.id,name:person.name||null,email:person.email||contact.invoice_email||null};
}
export function createMoneybirdReader({token,administrationId},request=fetch){
 if(!token||!moneybirdId(administrationId))throw new MoneybirdError('MONEYBIRD_CONFIG');
 async function get(path,params={}){
  const url=new URL(`https://moneybird.com/api/v2/${administrationId}/${path}.json`);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  let response;
  try{response=await request(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},method:'GET',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw new MoneybirdError('MONEYBIRD_UNAVAILABLE')}
  if(!response.ok)throw new MoneybirdError(response.status===401||response.status===403?'MONEYBIRD_ACCESS':response.status===404?'MONEYBIRD_CONTACT_MISSING':response.status===429?'MONEYBIRD_RATE_LIMIT':'MONEYBIRD_UNAVAILABLE');
  try{return await response.json()}catch{throw new MoneybirdError('MONEYBIRD_RESPONSE')}
 }
 return {
  async search(query,page=1){
   if(typeof query!=='string'||query.trim().length<2||query.length>200||!Number.isInteger(page)||page<1||page>1000)throw new MoneybirdError('MONEYBIRD_QUERY');
   const rows=await get('contacts',{query:query.trim(),page,per_page:25});
   if(!Array.isArray(rows))throw new MoneybirdError('MONEYBIRD_RESPONSE');
   return {contacts:rows.map(contactSummary),has_more:rows.length===25,page};
  },
  async byCustomerId(id){
   if(typeof id!=='string'||!/^BRB-[0-9a-f-]{36}$/.test(id))throw new MoneybirdError('MONEYBIRD_QUERY');
   try{const contact=contactSummary(await get(`contacts/customer_id/${encodeURIComponent(id)}`));if(contact.customer_id!==id)throw new MoneybirdError('MONEYBIRD_RESPONSE');return contact}catch(error){if(error instanceof Error&&error.message==='MONEYBIRD_CONTACT_MISSING')return null;throw error}
  },
  async contact(id){
   if(!moneybirdId(id))throw new MoneybirdError('MONEYBIRD_QUERY');
   const contact=contactSummary(await get(`contacts/${id}`));
   if(contact.id!==id)throw new MoneybirdError('MONEYBIRD_RESPONSE');
   return contact;
  }
 };
}
