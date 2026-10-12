import {serverClient} from '../../../lib/supabase/server';
import {supabaseConfig} from '../../../lib/supabase/config';
export async function GET(){
 const headers={'Cache-Control':'private, no-store'};
 const fail=(error:string,status:number)=>Response.json({error},{status,headers});
 if(!supabaseConfig())return fail('De accountdienst is nog niet ingesteld.',503);
 try{
  const client=await serverClient();
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user)return fail('Log in om je bedrijfstarieven te bekijken.',401);
  const {data:profile,error:profileError}=await client.from('profiles').select('status,company_id').eq('id',user.id).maybeSingle();
  if(profileError||!profile)return fail('Je accountgegevens zijn tijdelijk niet beschikbaar.',503);
  if(!user.email_confirmed_at||profile.status!=='approved'||!profile.company_id)return fail('Je account moet eerst worden goedgekeurd voordat je bedrijfstarieven kunt bekijken.',403);
  const today=new Date().toISOString().slice(0,10);
  const [{data:company,error:companyError},{data:purposes,error:purposeError},{data:prices,error:priceError}]=await Promise.all([
   client.from('companies').select('name,customer_number').eq('id',profile.company_id).maybeSingle(),
   client.from('usage_purposes').select('id,name').eq('active',true).order('sort_order').order('name'),
   client.from('company_prices').select('purpose_id,amount_cents,currency').eq('company_id',profile.company_id).lte('valid_from',today).or(`valid_until.is.null,valid_until.gt.${today}`)
  ]);
  if(companyError||purposeError||priceError||!company||!purposes||!prices)return fail('De tarieven zijn nog niet beschikbaar. Neem contact op met de beheerder.',503);
  // Company identity is derived exclusively from the verified profile, never a request parameter.
  return Response.json({company,prices:purposes.map(p=>{const matches=prices.filter(r=>r.purpose_id===p.id);const price=matches.length===1?matches[0]:null;return {purpose_id:p.id,name:p.name,amount_cents:price?.amount_cents??null,currency:price?.currency??'EUR'};})},{headers});
 }catch{return fail('De tariefdienst is tijdelijk niet bereikbaar. Probeer opnieuw.',503)}
}
