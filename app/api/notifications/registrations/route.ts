import {dispatchRegistrations} from '../../../../lib/notifications/worker.mjs';
import {validJobSecret} from '../../../../lib/notifications/registration.mjs';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 if(process.env.REGISTRATION_NOTIFICATIONS_ENABLED!=='true')return Response.json({error:'Notificatiemail is uitgeschakeld.'},{status:503,headers});
 const secret=process.env.NOTIFICATION_JOB_SECRET;
 if(!validJobSecret(request.headers.get('x-notification-secret'),secret))return Response.json({error:'Niet toegestaan.'},{status:401,headers});
 try {
  const result=await dispatchRegistrations();
  return Response.json(result,{status:result.retry?503:200,headers});
 }catch{return Response.json({error:'De mailvoorziening is tijdelijk niet bereikbaar.'},{status:503,headers})}
}
