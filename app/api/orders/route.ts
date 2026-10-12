import {serverClient} from '../../../lib/supabase/server';
const headers={'Cache-Control':'private, no-store'};
const fail=(error:string,status:number)=>Response.json({error},{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messages:Record<string,string>={APPROVAL_REQUIRED:'Je account moet eerst worden goedgekeurd.',DRAWING_UNAVAILABLE:'Deze tekening is niet beschikbaar om te bestellen.',PURPOSE_UNAVAILABLE:'Dit gebruiksdoel is niet beschikbaar.',PRICE_UNAVAILABLE:'Voor dit gebruiksdoel is geen tarief beschikbaar.',CONSENT_REQUIRED:'Bevestig eerst de akkoordverklaring.',QUOTE_CHANGED:'De prijs of voorwaarden zijn gewijzigd. Vernieuw de pagina en controleer de nieuwe afspraak.'};
async function run(body:Record<string,unknown>,confirm:boolean){
 if(typeof body.drawing_key!=='string'||!/^NVH-\d{4}$/.test(body.drawing_key)||typeof body.purpose_id!=='string'||!uuid.test(body.purpose_id))return fail('Kies een geldige tekening en gebruiksdoel.',400);
 if(confirm&&(body.accepted!==true||typeof body.agreement_id!=='string'||!uuid.test(body.agreement_id)||!Number.isInteger(body.expected_amount_cents)||Number(body.expected_amount_cents)<0||Number(body.expected_amount_cents)>2147483647||typeof body.expected_agreement_text!=='string'||body.expected_agreement_text.length>20000))return fail('Controleer de bestelling en bevestig de akkoordverklaring.',400);
 try{
  const client=await serverClient();const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user)return fail('Log opnieuw in.',401);
  const args={p_drawing_key:body.drawing_key,p_purpose_id:body.purpose_id};
  const {data,error}=confirm?await client.rpc('place_test_order',{...args,p_agreement_id:body.agreement_id,p_expected_amount_cents:body.expected_amount_cents,p_expected_agreement_text:body.expected_agreement_text,p_accepted:true}):await client.rpc('test_order_quote',args);
  if(error){const key=Object.keys(messages).find(k=>error.message.includes(k));return fail(key?messages[key]:'De bestelbevestiging is nog niet beschikbaar. Probeer later opnieuw.',key==='QUOTE_CHANGED'?409:key==='APPROVAL_REQUIRED'?403:key?400:503);}
  const {data:admin}=await client.rpc('is_onedrive_admin');
  return Response.json({...data,can_test_download:admin===true&&data?.owned===true&&data?.is_test===true&&body.drawing_key==='NVH-0001'},{headers});
 }catch{return fail('De bestelservice is tijdelijk niet bereikbaar.',503)}
}
export async function GET(request:Request){return run(Object.fromEntries(new URL(request.url).searchParams),false)}
export async function POST(request:Request){
 // Browser cookie authentication: accept mutations only from the same site.
 const origin=request.headers.get('origin');const host=request.headers.get('host');
 try{if(!origin||new URL(origin).host!==host)return fail('Ongeldige aanvraag.',403)}catch{return fail('Ongeldige aanvraag.',403)}
 try{const body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body))return fail('Ongeldige aanvraag.',400);return run(body,true)}catch{return fail('Ongeldige aanvraag.',400)}
}
