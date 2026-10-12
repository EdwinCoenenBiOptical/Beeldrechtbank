import {serverClient} from '../../../../lib/supabase/server';
const headers={'Cache-Control':'private, no-store'};
const fail=(error:string,status:number)=>Response.json({error},{status,headers});
const messages:Record<string,string>={ADMIN_REQUIRED:'Alleen de beheerder kan aanvragen beoordelen.',SELF_REVIEW_FORBIDDEN:'Je kunt je eigen account niet beoordelen.',APPLICATION_MISSING:'Deze aanvraag bestaat niet meer.',APPLICATION_ALREADY_REVIEWED:'Deze aanvraag is al beoordeeld. Vernieuw het overzicht.',EMAIL_CONFIRMATION_REQUIRED:'Het e-mailadres moet eerst worden bevestigd.',COMPANY_MISMATCH:'Het gekozen bedrijf heeft een ander KvK-nummer.',COMPANY_NAME_REQUIRED:'Vul een bedrijfsnaam in.',INVALID_DECISION:'Kies goedkeuren of afwijzen.',INVALID_FILTER:'Ongeldig filter.'};
async function run(args:Record<string,unknown>,review:boolean){
 try{
  const client=await serverClient();const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return fail('Log in met je beheeraccount.',401);
  const {data,error}=await client.rpc(review?'admin_review_application':'admin_application_overview',args);
  if(error){const code=Object.keys(messages).find(k=>error.message.includes(k));return fail(code?messages[code]:'Het beheerscherm is nog niet beschikbaar. Controleer of het beheerscript is uitgevoerd.',code==='ADMIN_REQUIRED'?403:code==='APPLICATION_ALREADY_REVIEWED'?409:code?400:503)}
  return Response.json(data,{headers});
 }catch{return fail('Het beheerscherm is tijdelijk niet bereikbaar.',503)}
}
export async function GET(request:Request){const url=new URL(request.url),raw=url.searchParams.get('page')||'1',status=url.searchParams.get('status')||'pending';if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>100000||!['pending','approved','rejected','suspended'].includes(status))return fail('Ongeldig filter.',400);return run({p_page:Number(raw),p_status:status},false)}
export async function POST(request:Request){
 try{const origin=request.headers.get('origin');if(!origin||new URL(origin).host!==request.headers.get('host'))return fail('Ongeldige aanvraag.',403)}catch{return fail('Ongeldige aanvraag.',403)}
 try{const body=await request.json();const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;if(typeof body?.profile_id!=='string'||!uuid.test(body.profile_id)||!['approved','rejected'].includes(body.decision)||body.company_id!=null&&(typeof body.company_id!=='string'||!uuid.test(body.company_id))||body.company_name!=null&&(typeof body.company_name!=='string'||body.company_name.length>200))return fail('Controleer de aanvraag en bedrijfsgegevens.',400);return run({p_profile_id:body.profile_id,p_decision:body.decision,p_company_id:body.company_id||null,p_company_name:body.company_name||null},true)}catch{return fail('Ongeldige aanvraag.',400)}
}
