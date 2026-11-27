import { createClient } from '@supabase/supabase-js';
import { mailConfiguration, orderSender } from '../mail/order-confirmation.mjs';
import { rootnetTransport } from '../mail/transport.mjs';
import { registrationMail, registrationRecipient } from './registration.mjs';

// A durable queue isolates registrations from mail failures. Only the server can claim jobs.
export async function dispatchRegistrations({env=process.env,client,transport}={}) {
  if(env.REGISTRATION_NOTIFICATIONS_ENABLED!=='true') return {disabled:true,sent:0,retry:0};
  const config=mailConfiguration(env);
  const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!client&&(!url||!key)) throw Error('REGISTRATION_SERVER_CONFIG');
  client??=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:records,error}=await client.rpc('claim_smtp_registration_notifications',{p_limit:3});
  if(error) throw Error('REGISTRATION_QUEUE_UNAVAILABLE');
  if(!records?.length) return {sent:0,retry:0};
  transport??=rootnetTransport(config);
  let sent=0,retry=0;
  try {
    for(const record of records) {
      let providerId=null,errorCode=null;
      try {
        const message=registrationMail(record,orderSender);
        const result=await transport.sendMail({...message,messageId:`<registration-${record.id}@beeldrechtbank.nl>`});
        if(!result.accepted?.some(address=>String(address).toLowerCase()===registrationRecipient)) throw Error('SMTP_NOT_ACCEPTED');
        providerId=result.messageId||`registration-${record.id}`;
      } catch {errorCode='REGISTRATION_SMTP_FAILED';}
      const {data:finished,error:finishError}=await client.rpc('finish_registration_notification',{p_id:record.id,p_lock_token:record.lock_token,p_provider_id:providerId,p_error_code:errorCode});
      if(finishError||!finished) throw Error('REGISTRATION_STATUS_UNCERTAIN');
      if(providerId)sent++;else retry++;
    }
    return {sent,retry};
  } finally {try{transport.close();}catch{/* No effect on accepted mail. */}}
}
