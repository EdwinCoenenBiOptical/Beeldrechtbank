import {randomUUID} from 'node:crypto';
import {moneybirdAdmin,originCheck,apiError,headers,fail,uuid} from '../../../../../lib/moneybird/server';
import {connectionConfig,connectedReader,connectedContactCreator} from '../../../../../lib/moneybird/connection';
import {serviceClient} from '../../../../../lib/supabase/service';
import {contactDraft,runContactCreation} from '../../../../../lib/moneybird/create-contact.mjs';
const messages:Record<string,string>={CONTACT_INPUT:'Controleer het factuuradres, de postcode, plaats, landcode en het factuur-e-mailadres.',CONTACT_CREATE_BUSY:'Er loopt al een aanmaakcontrole. Wacht even en vernieuw het bedrijf.',CONTACT_CREATE_UNCERTAIN:'De eerdere aanmaak is nog niet bevestigd. We maken geen tweede contact aan. Controleer de aanmaakstatus later opnieuw of zoek het contact in Moneybird.',CONTACT_ALREADY_EXISTS:'Dit KvK-nummer bestaat al in Moneybird. Zoek opnieuw op KvK en koppel het bestaande contact.',CONTACT_PROVIDER_VALIDATION:'Moneybird heeft de gegevens niet geaccepteerd. Controleer de factuurgegevens en of er al een klant bestaat.',CONTACT_CREATED_MISMATCH:'Het gevonden contact past niet bij deze aanmaak. Controleer het contact handmatig in Moneybird; er wordt geen tweede contact aangemaakt.',CONTACT_SEARCH_INCOMPLETE:'De controle op bestaande klanten kon niet worden afgerond. Er is geen nieuw contact aangemaakt.',COMPANY_ALREADY_LINKED:'Het bedrijf is al gekoppeld. Vernieuw het bedrijf om de actuele koppeling te zien.',COMPANY_CHANGED:'De bedrijfsgegevens zijn ondertussen gewijzigd. Vernieuw het bedrijf.',CREATION_MISSING:'Er bestaat nog geen aanmaakpoging voor dit bedrijf.',CREATION_BUSY:'De aanmaak wordt door een ander verzoek gecontroleerd. Probeer later opnieuw.',CONNECTION_REQUIRED:'De Moneybird-verbinding is gewijzigd. Verbind opnieuw en controleer de aanmaakstatus.',CREATION_DATABASE:'De aanmaakstatus kon niet worden opgeslagen. Vernieuw het bedrijf en controleer de eerdere poging voordat je verdergaat.'};
export async function POST(request:Request){
 try{
  originCheck(request);const {client,user}=await moneybirdAdmin();let body;try{body=await request.json()}catch{return fail('Ongeldige aanvraag.',400)}
  if(!uuid(body?.company_id)||body.confirmed!==true||body.resume!=null&&typeof body.resume!=='boolean')return fail('Controleer het bedrijf en bevestig de aanmaak.',400);
  const config=connectionConfig();const {data:state,error}=await client.rpc('admin_moneybird_company',{p_company_id:body.company_id});
  if(error||!state?.company)return fail('Het bedrijf kon niet worden geladen. Vernieuw het overzicht.',503);
  if(state.link)return fail(messages.COMPANY_ALREADY_LINKED,409);
  if(body.expected_company_name!==state.company.name||body.expected_kvk!==state.company.kvk_number)return fail(messages.COMPANY_CHANGED,409);
  const draft=body.resume?null:contactDraft(state.company,body.draft),owner=randomUUID(),service=serviceClient();
  const reader=await connectedReader(user.id),writer=await connectedContactCreator(user.id);
  const repository=async(action:string,data:Record<string,unknown>={})=>{
   const {data:result,error}=await service.rpc('server_moneybird_contact_creation',{p_actor_id:user.id,p_company_id:body.company_id,p_administration_id:config.administrationId,p_owner:owner,p_action:action,p_data:data});
   if(error){const known=[...Object.keys(messages),'ADMIN_REQUIRED','CREATION_ALREADY_SENT','INVALID_CREATION'].find(c=>error.message.includes(c));throw Error(known||'CREATION_DATABASE')}return result;
  };
  const result=await runContactCreation({repository,reader,writer,draft,resume:body.resume===true});return Response.json(result,{headers});
 }catch(error){const code=error instanceof Error?error.message:'';if(code==='ADMIN_REQUIRED')return fail('Je beheerrechten zijn gewijzigd. Log opnieuw in.',403);if(code in messages)return Response.json({error:messages[code],code,contacts:code==='CONTACT_ALREADY_EXISTS'&&error&&typeof error==='object'&&'contacts' in error?error.contacts:undefined},{status:code==='CONTACT_INPUT'||code==='CONTACT_PROVIDER_VALIDATION'?400:code==='CONTACT_CREATE_UNCERTAIN'||code==='CREATION_DATABASE'?503:409,headers});return apiError(error)}
}
