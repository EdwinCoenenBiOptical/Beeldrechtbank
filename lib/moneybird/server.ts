import 'server-only';
import {serverClient} from '../supabase/server';
import {createMoneybirdReader} from './contacts.mjs';
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
export const moneybirdConfig=()=>({token:process.env.MONEYBIRD_API_TOKEN,administrationId:process.env.MONEYBIRD_ADMINISTRATION_ID});
export const moneybirdReader=()=>createMoneybirdReader(moneybirdConfig());
export const headers={'Cache-Control':'private, no-store'};
export const fail=(error:string,status:number)=>Response.json({error},{status,headers});
export function originCheck(request:Request){try{if(!request.headers.get('origin')||new URL(request.headers.get('origin')!).host!==request.headers.get('host'))throw Error()}catch{throw new AdminError('Ongeldige aanvraag.',403)}}
export function apiError(error:unknown){
 if(error instanceof AdminError)return fail(error.message,error.status);
 const messages:Record<string,string>={MONEYBIRD_CONFIG:'De Moneybird-verbinding is nog niet ingesteld.',MONEYBIRD_ACCESS:'Moneybird weigert toegang. Controleer de API-token en administratie.',MONEYBIRD_CONTACT_MISSING:'Dit Moneybird-contact bestaat niet meer of is niet toegankelijk.',MONEYBIRD_PERSON_MISSING:'Deze contactpersoon hoort niet meer bij het gekozen Moneybird-contact. Zoek het contact opnieuw.',MONEYBIRD_RATE_LIMIT:'Moneybird ontvangt te veel verzoeken. Probeer het later opnieuw.',MONEYBIRD_QUERY:'Vul een geldige zoekopdracht of contactkeuze in.',MONEYBIRD_RESPONSE:'Moneybird gaf onverwachte contactgegevens terug. Probeer het later opnieuw.',DOWNLOAD_SERVER_CONFIG_REQUIRED:'De serververbinding is nog niet ingesteld.'};
 const code=error instanceof Error?error.message:'';
 return fail(messages[code]||'De Moneybird-verbinding is tijdelijk niet bereikbaar. Probeer opnieuw.',code==='MONEYBIRD_QUERY'||code==='MONEYBIRD_PERSON_MISSING'?400:503);
}
