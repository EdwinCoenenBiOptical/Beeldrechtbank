import {createClient} from '@supabase/supabase-js';
import {supabaseConfig} from '../../../../lib/supabase/config';
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
export async function POST(request:Request){
 try{const origin=request.headers.get('origin');if(!origin||new URL(origin).host!==request.headers.get('host'))return Response.json({error:'Ongeldige aanvraag.'},{status:403,headers})}catch{return Response.json({error:'Ongeldige aanvraag.'},{status:403,headers})}
 try{
  const body=await request.json();if(typeof body?.token_hash!=='string'||!/^[a-f0-9]{64}$/i.test(body.token_hash))return Response.json({error:'Ongeldige bevestigingslink.'},{status:400,headers});
  const config=supabaseConfig();if(!config)return Response.json({error:'De accountdienst is nog niet ingesteld.'},{status:503,headers});
  // Verify the mailbox without replacing any existing browser login or persisting tokens.
  const client=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {error}=await client.auth.verifyOtp({token_hash:body.token_hash,type:'email'});
  if(error)return Response.json({error:'Deze link is verlopen of al gebruikt. Probeer in te loggen of vraag een nieuwe bevestigingsmail aan.'},{status:400,headers});
  return Response.json({confirmed:true},{headers});
 }catch{return Response.json({error:'De bevestiging kon niet worden verwerkt. Probeer opnieuw.'},{status:503,headers})}
}
