import {moneybirdAdmin,originCheck,uuid,headers,fail,apiError} from '../../../../lib/moneybird/server';
import {serviceClient} from '../../../../lib/supabase/service';
import {automationRpc} from '../../../../lib/moneybird/automation-worker.mjs';
export async function GET(){try{
 const {user}=await moneybirdAdmin();return Response.json(await automationRpc(serviceClient())('settings',{actor:user.id}),{headers});
}catch(error){return apiError(error)}}
export async function POST(request:Request){try{
 originCheck(request);const {user}=await moneybirdAdmin();let body;
 try{body=await request.json()}catch{return fail('Ongeldige aanvraag.',400)}
 if(body?.action==='configure'&&typeof body.enabled==='boolean'&&body.confirmed===true){
  return Response.json(await automationRpc(serviceClient())('configure',{actor:user.id,data:{enabled:body.enabled}}),{headers});
 }
 if(body?.action==='retry'&&uuid(body.order_id)){
  await automationRpc(serviceClient())('retry',{actor:user.id,order:body.order_id});return Response.json({ok:true},{headers});
 }
 return fail('Bevestig de instelling of kies een geldige bestelling.',400);
}catch(error){return apiError(error)}}
