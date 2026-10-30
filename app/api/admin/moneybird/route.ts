import {serviceClient} from '../../../../lib/supabase/service';
import {moneybirdId,invoiceRecipient} from '../../../../lib/moneybird/contacts.mjs';
import {apiError,moneybirdAdmin,moneybirdReader,moneybirdConfig,uuid,headers,fail,originCheck} from '../../../../lib/moneybird/server';
export async function GET(request:Request){
 try{const {client}=await moneybirdAdmin();const id=new URL(request.url).searchParams.get('company_id');if(!uuid(id))return fail('Kies een geldig bedrijf.',400);
  const {data,error}=await client.rpc('admin_moneybird_company',{p_company_id:id});
  if(error)return fail(error.message.includes('COMPANY_MISSING')?'Dit bedrijf bestaat niet meer.':'De bedrijfskoppeling is nog niet beschikbaar. Controleer script 010.',error.message.includes('COMPANY_MISSING')?404:503);
  const config=moneybirdConfig();return Response.json({...data,configured:!!config.token&&moneybirdId(config.administrationId),administration_id:moneybirdId(config.administrationId)?config.administrationId:null},{headers});
 }catch(error){return apiError(error)}
}
export async function POST(request:Request){
 try{
  originCheck(request);const {client,user}=await moneybirdAdmin();let body;try{body=await request.json()}catch{return fail('Ongeldige aanvraag.',400)}
  if(!uuid(body?.company_id)||!moneybirdId(body.contact_id)||body.contact_person_id!=null&&!moneybirdId(body.contact_person_id)||!Number.isInteger(body.expected_revision)||body.expected_revision<0||body.reason!=null&&(typeof body.reason!=='string'||body.reason.length>1000)||body.confirmed!==true)return fail('Controleer bedrijf, contact en contactpersoon en bevestig de koppeling.',400);
  const {error:companyError}=await client.rpc('admin_moneybird_company',{p_company_id:body.company_id});if(companyError)return fail('Het bedrijf kon niet worden geladen. Vernieuw het overzicht en controleer script 010.',503);
  // IDs only from the browser; re-read every contact and person from Moneybird.
  const contact=await moneybirdReader().contact(body.contact_id),recipient=invoiceRecipient(contact,body.contact_person_id||null);
  const {data,error}=await serviceClient().rpc('server_link_moneybird_company',{p_actor_id:user.id,p_company_id:body.company_id,p_administration_id:moneybirdConfig().administrationId,p_contact_id:contact.id,p_contact_snapshot:contact,p_recipient_snapshot:recipient,p_expected_revision:body.expected_revision,p_reason:body.reason?.trim()||null});
  if(error){const messages:Record<string,string>={ADMIN_REQUIRED:'Je beheerrechten zijn gewijzigd. Log opnieuw in.',LINK_CHANGED:'De koppeling is ondertussen gewijzigd. Vernieuw het bedrijf.',CONTACT_ALREADY_LINKED:'Dit Moneybird-contact is al aan een ander portalbedrijf gekoppeld.',LINK_REASON_REQUIRED:'Geef een reden voor het afwijkende KvK-nummer of het vervangen van de koppeling.',COMPANY_MISSING:'Dit bedrijf bestaat niet meer.'};const code=Object.keys(messages).find(c=>error.message.includes(c));return fail(code?messages[code]:'De koppeling kon niet worden opgeslagen. Controleer script 010 en probeer opnieuw.',code==='ADMIN_REQUIRED'?403:code==='LINK_CHANGED'||code==='CONTACT_ALREADY_LINKED'?409:code?400:503)}
  return Response.json({link:data},{headers});
 }catch(error){return apiError(error)}
}
