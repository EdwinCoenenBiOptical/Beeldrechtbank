import 'server-only';
import {serverClient} from '../supabase/server';
import {connectedReader} from './connection';
export class AdminError extends Error {constructor(message:string,public status:number){super(message)}}
export async function moneybirdAdmin(){
 const client=await serverClient();const {data:{user},error}=await client.auth.getUser();
 if(error||!user)throw new AdminError('Log in met je beheeraccount.',401);
 const {data:admin,error:adminError}=await client.rpc('is_app_admin');
 if(adminError)throw new AdminError('Het beheer is nog niet beschikbaar. Controleer script 007.',503);
 if(admin!==true)throw new AdminError('Alleen de beheerder kan Moneybird-koppelingen beheren.',403);
 return {client,user};
}
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const moneybirdConfig=()=>({administrationId:process.env.MONEYBIRD_ADMINISTRATION_ID});
export const moneybirdReader=(actor:string)=>connectedReader(actor);
export const headers={'Cache-Control':'private, no-store'};
export const fail=(error:string,status:number)=>Response.json({error},{status,headers});
export function originCheck(request:Request){try{if(!request.headers.get('origin')||new URL(request.headers.get('origin')!).host!==request.headers.get('host'))throw Error()}catch{throw new AdminError('Ongeldige aanvraag.',403)}}
export function apiError(error:unknown){
 if(error instanceof AdminError)return fail(error.message,error.status);
 const messages:Record<string,string>={MONEYBIRD_CONFIG:'De Moneybird-verbinding is nog niet ingesteld.',MONEYBIRD_OAUTH_CONFIG:'De OAuth-appgegevens of de ingestelde scope zijn nog niet ingesteld.',MONEYBIRD_ENCRYPTION_CONFIG:'De beveiligde tokenopslag is nog niet ingesteld.',MONEYBIRD_RECONNECT:'Verbind Moneybird opnieuw via de beheerpagina.',MONEYBIRD_REFRESH_BUSY:'De verbinding wordt vernieuwd. Probeer het over enkele seconden opnieuw.',MONEYBIRD_OAUTH_REJECTED:'Moneybird kon de toestemming niet vernieuwen. Verbind opnieuw.',MONEYBIRD_SCOPE_CHANGED:'Moneybird gaf andere rechten terug dan aangevraagd. Verbind opnieuw met de ingestelde scope.',MONEYBIRD_DATABASE:'De beveiligde Moneybird-opslag is nog niet beschikbaar. Controleer script 011.',MONEYBIRD_CONNECTION_CHANGED:'De verbinding is ondertussen gewijzigd. Probeer opnieuw.',MONEYBIRD_ADMIN_CHANGED:'Je beheerrechten zijn gewijzigd. Log opnieuw in.',MONEYBIRD_STATE_INVALID:'Deze verbindingspoging is verlopen of al gebruikt. Start opnieuw.',MONEYBIRD_ORIGIN:'Deze aanvraag komt niet van de ingestelde website.',MONEYBIRD_ACCESS:'Moneybird weigert toegang. Controleer de toestemming en de ingestelde administratie.',MONEYBIRD_CONTACT_MISSING:'Dit Moneybird-contact bestaat niet meer of is niet toegankelijk.',MONEYBIRD_PERSON_MISSING:'Deze contactpersoon hoort niet meer bij het gekozen Moneybird-contact. Zoek het contact opnieuw.',MONEYBIRD_RATE_LIMIT:'Moneybird ontvangt te veel verzoeken. Probeer het later opnieuw.',MONEYBIRD_QUERY:'Vul een geldige zoekopdracht of contactkeuze in.',MONEYBIRD_RESPONSE:'Moneybird gaf onverwachte contactgegevens terug. Probeer het later opnieuw.',DOWNLOAD_SERVER_CONFIG_REQUIRED:'De serververbinding is nog niet ingesteld.'};
 const code=error instanceof Error?error.message:'';
 return fail(messages[code]||'De Moneybird-verbinding is tijdelijk niet bereikbaar. Probeer opnieuw.',code==='MONEYBIRD_ADMIN_CHANGED'||code==='MONEYBIRD_ORIGIN'?403:code==='MONEYBIRD_QUERY'||code==='MONEYBIRD_PERSON_MISSING'?400:503);
}
