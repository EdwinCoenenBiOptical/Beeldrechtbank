import {createClient} from '@supabase/supabase-js';
import {validJobSecret,deliverRegistration} from '../../../../lib/notifications/registration.mjs';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 const secret=process.env.NOTIFICATION_JOB_SECRET;
 if(!validJobSecret(request.headers.get('x-notification-secret'),secret))return Response.json({error:'Niet toegestaan.'},{status:401,headers});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 const apiKey=process.env.RESEND_API_KEY,from=process.env.NOTIFICATION_FROM_EMAIL;
 if(!url||!key||!apiKey||!from)return Response.json({error:'De mailvoorziening is nog niet ingesteld.'},{status:503,headers});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:records,error}=await client.rpc('claim_registration_notifications',{p_limit:3});
  if(error)return Response.json({error:'De notificatiewachtrij is nog niet beschikbaar.'},{status:503,headers});
  let sent=0,retry=0;
  for(const record of records||[]){
   let providerId:null|string=null,errorCode:null|string=null;
   try{providerId=await deliverRegistration(record,{from,apiKey});}catch{errorCode='MAIL_DELIVERY_FAILED';}
   const {data:finished,error:finishError}=await client.rpc('finish_registration_notification',{p_id:record.id,p_lock_token:record.lock_token,p_provider_id:providerId,p_error_code:errorCode});
   if(finishError||!finished)return Response.json({error:'De verzendstatus kon niet worden opgeslagen.'},{status:503,headers});
   if(providerId)sent++;else retry++;
  }
  return Response.json({sent,retry},{status:retry?503:200,headers});
 }catch{return Response.json({error:'De mailvoorziening is tijdelijk niet bereikbaar.'},{status:503,headers})}
}
