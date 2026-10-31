import {createHash} from 'node:crypto';
import {moneybirdId,MoneybirdError} from './contacts.mjs';
export class InvoiceWriteError extends MoneybirdError {constructor(code,uncertain){super(code);this.uncertain=uncertain}}
export function decimalCents(value){
 if(typeof value!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value))throw new MoneybirdError('INVOICE_RESPONSE');
 const [whole,fraction='']=value.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents))throw new MoneybirdError('INVOICE_RESPONSE');return cents;
}
export const decimalPrice=cents=>{if(!Number.isSafeInteger(cents)||cents<0)throw new MoneybirdError('INVOICE_PLAN');return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`};
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value}
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function invoiceSummary(raw){
 if(!raw||!moneybirdId(raw.id)||!moneybirdId(raw.contact_id)||typeof raw.reference!=='string'||typeof raw.state!=='string'||!Array.isArray(raw.details))throw new MoneybirdError('INVOICE_RESPONSE');
 if(typeof raw.version!=='string'&&!(typeof raw.version==='number'&&Number.isSafeInteger(raw.version)))throw new MoneybirdError('INVOICE_RESPONSE');
 return {id:raw.id,contact_id:raw.contact_id,contact_person_id:raw.contact_person_id||null,reference:raw.reference,state:raw.state,version:String(raw.version),invoice_number:typeof raw.invoice_id==='string'?raw.invoice_id:null,invoice_date:raw.invoice_date||null,due_date:raw.due_date||null,sent_at:raw.sent_at||null,currency:raw.currency,prices_are_incl_tax:raw.prices_are_incl_tax,
 amount_cents:decimalCents(raw.total_price_excl_tax),total_cents:decimalCents(raw.total_price_incl_tax),
 details:raw.details.map(d=>({description:d.description,amount:String(d.amount_decimal??d.amount),amount_cents:decimalCents(d.price),tax_rate_id:d.tax_rate_id,ledger_account_id:d.ledger_account_id})),
 contact:{name:raw.contact?.company_name||'',address:[raw.contact?.address1,raw.contact?.address2,raw.contact?.zipcode,raw.contact?.city,raw.contact?.country].filter(v=>typeof v==='string'&&v).join(', ')}};
}
export function validateInvoice(invoice,plan){
 if(invoice.reference!==plan.reference||invoice.contact_id!==plan.contact_id||invoice.currency!=='EUR'||invoice.prices_are_incl_tax!==false||invoice.amount_cents!==plan.amount_cents||invoice.total_cents!==plan.total_cents||invoice.total_cents-invoice.amount_cents!==plan.vat_cents||invoice.details.length!==plan.items.length)throw new MoneybirdError('INVOICE_MISMATCH');
 for(let i=0;i<plan.items.length;i++){const a=invoice.details[i],b=plan.items[i];if(a.description!==b.description||!/^1(?:\.0+)?$/.test(a.amount)||a.amount_cents!==b.amount_cents||a.tax_rate_id!==plan.tax_rate_id||a.ledger_account_id!==plan.ledger_account_id)throw new MoneybirdError('INVOICE_MISMATCH')}
 if(invoice.contact_person_id!==plan.contact_person_id)throw new MoneybirdError('INVOICE_MISMATCH');
 return invoice;
}
export function issuedInvoice(invoice){return !!invoice.sent_at||['open','late','paid','scheduled','pending_payment','uncollectible'].includes(invoice.state)}
export function fixedInvoiceSettings(options){
 const taxes=options.tax_rates,ledgers=options.ledger_accounts.filter(l=>l.account_code==='80300');
 if(taxes.length!==1||ledgers.length!==1)throw new MoneybirdError('INVOICE_FIXED_SETTINGS');
 return {tax:taxes[0],ledger:ledgers[0]};
}
export function buildInvoicePlan(source,contact,recipient,options){
 const {tax,ledger}=fixedInvoiceSettings(options),taxId=tax.id,ledgerId=ledger.id;
 if(contact.country!=='NL')throw new MoneybirdError('INVOICE_DOMESTIC_ONLY');
 if(contact.id!==source.link.contact_id||contact.kvk.replace(/\D/g,'')!==source.company.kvk_number||!contact.address1||!contact.zipcode||!contact.city||!contact.country)throw new MoneybirdError('INVOICE_CONTACT');
 const email=(recipient.email||'').trim().toLowerCase(),buyer=(source.buyer_email||'').trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email!==buyer)throw new MoneybirdError('INVOICE_SELF_ONLY');
 let amount=0,vat=0,total=0;
 if(!Array.isArray(source.items)||!source.items.length||source.items.length>25)throw new MoneybirdError('INVOICE_PLAN');
 const items=source.items.map(i=>{const a=Number(i.amount_cents),v=Number(i.vat_cents),t=Number(i.total_cents);if(![a,v,t].every(Number.isSafeInteger)||a<0||i.vat_percent!==21||i.currency!=='EUR'||v!==Math.floor((a*21+50)/100)||t!==a+v)throw new MoneybirdError('INVOICE_PLAN');amount+=a;vat+=v;total+=t;return {description:`Proeffactuur Beeldrechtbank - testbestelling ${source.order.order_number} - ${i.drawing_title_snapshot} (${i.purpose_name_snapshot})`,amount_cents:a}});
 if(![amount,vat,total].every(Number.isSafeInteger)||total<=0)throw new MoneybirdError('INVOICE_PLAN');
 return {order_id:source.order.id,order_number:source.order.order_number,company_id:source.company.id,company_kvk:source.company.kvk_number,company_name:source.order.company_name_snapshot,administration_id:source.link.administration_id,contact_id:contact.id,contact_person_id:recipient.id,recipient_email:email,contact_name:contact.name,contact_address:contact.address,link_revision:source.link.revision,reference:'BRB-PROEF-'+source.order.id,tax_rate_id:taxId,tax_rate_name:tax.name,ledger_account_id:ledgerId,ledger_account_name:ledger.name,ledger_account_code:'80300',items,amount_cents:amount,vat_cents:vat,total_cents:total,currency:'EUR'};
}
export function createMoneybirdInvoices({token,administrationId},request=fetch){
 if(!token||!moneybirdId(administrationId))throw new MoneybirdError('MONEYBIRD_CONFIG');
 async function api(path,{method='GET',body,params={},paginate=false}={}){
  const url=new URL(`https://moneybird.com/api/v2/${administrationId}/${path}.json`);for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  let r;try{r=await request(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)})}catch{throw method==='GET'?new MoneybirdError('MONEYBIRD_UNAVAILABLE'):new InvoiceWriteError('INVOICE_WRITE_UNCERTAIN',true)}
  if(!r.ok){const code=r.status===401||r.status===403?'MONEYBIRD_ACCESS':r.status===404?'INVOICE_MISSING':r.status===429?'MONEYBIRD_RATE_LIMIT':'INVOICE_PROVIDER_REJECTED';if(method==='GET')throw new MoneybirdError(code);throw new InvoiceWriteError(code,![400,401,403,404,422,429].includes(r.status))}
  if(r.status===204)return null;
  try{const data=await r.json();return paginate?{rows:data,next:/;\s*rel=(?:"next"|next)(?:[,\s]|$)/.test(r.headers.get('link')||'')}:data}catch{throw method==='GET'?new MoneybirdError('INVOICE_RESPONSE'):new InvoiceWriteError('INVOICE_WRITE_UNCERTAIN',true)}
 }
 async function pages(path){const rows=[];for(let page=1;page<=100;page++){const paged=await api(path,{params:{page,per_page:100},paginate:true}),batch=paged.rows;if(!Array.isArray(batch))throw new MoneybirdError('INVOICE_RESPONSE');rows.push(...batch);if(!paged.next&&batch.length<100)return rows}throw new MoneybirdError('INVOICE_SEARCH_INCOMPLETE')}
 return {
  async options(){const [taxes,ledgers]=await Promise.all([pages('tax_rates'),pages('ledger_accounts')]);return {tax_rates:taxes.filter(t=>moneybirdId(t.id)&&t.active!==false&&t.show_tax!==false&&Number(t.percentage)===21&&t.tax_rate_type==='sales_invoice'&&(!t.country||t.country==='NL')).map(t=>({id:t.id,name:t.name})),ledger_accounts:ledgers.filter(l=>moneybirdId(l.id)&&l.account_type==='revenue'&&(!Array.isArray(l.allowed_document_types)||l.allowed_document_types.includes('sales_invoice'))).map(l=>({id:l.id,name:l.name,account_code:String(l.account_id??'')}))}},
  async findReference(reference){if(!/^BRB-PROEF-[0-9a-f-]{36}$/.test(reference))throw new MoneybirdError('INVOICE_PLAN');const matches=(await pages('sales_invoices')).filter(i=>i.reference===reference);if(matches.length>1)throw new MoneybirdError('INVOICE_REFERENCE_AMBIGUOUS');return matches.length?matches[0].id:null},
  async get(id){if(!moneybirdId(id))throw new MoneybirdError('INVOICE_PLAN');const raw=await api('sales_invoices/'+id);const result=invoiceSummary(raw);if(result.id!==id)throw new MoneybirdError('INVOICE_RESPONSE');return result},
  async create(plan){const raw=await api('sales_invoices',{method:'POST',body:{sales_invoice:{contact_id:plan.contact_id,...(plan.contact_person_id?{contact_person_id:plan.contact_person_id}:{}),reference:plan.reference,currency:'EUR',prices_are_incl_tax:false,discount:'0.0',details_attributes:plan.items.map(i=>({description:i.description,amount:'1',price:decimalPrice(i.amount_cents),tax_rate_id:plan.tax_rate_id,ledger_account_id:plan.ledger_account_id}))}}});if(!moneybirdId(raw?.id))throw new InvoiceWriteError('INVOICE_WRITE_UNCERTAIN',true);return raw.id},
  async send(id,email){if(!moneybirdId(id)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new MoneybirdError('INVOICE_PLAN');await api(`sales_invoices/${id}/send_invoice`,{method:'PATCH',body:{sales_invoice_sending:{delivery_method:'Email',email_address:email,email_message:'Dit is de afgesproken testfactuur voor Beeldrechtbank. Deze wordt handmatig gecrediteerd. Er wordt geen betaling verwacht.',sending_scheduled:false,mergeable:false}}})}
 };
}
