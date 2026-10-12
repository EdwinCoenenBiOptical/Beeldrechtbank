import {serverClient} from '../../../../lib/supabase/server';
const headers={'Cache-Control':'private, no-store'};
const fail=(error:string,status:number)=>Response.json({error},{status,headers});
export async function GET(request:Request){
 const raw=new URL(request.url).searchParams.get('page')||'1';
 if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1||Number(raw)>100000)return fail('Ongeldige pagina.',400);
 const page=Number(raw),size=10;
 try{
  const client=await serverClient();const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user)return fail('Log opnieuw in om je bestellingen te bekijken.',401);
  const {data:profile,error:profileError}=await client.from('profiles').select('status,company_id').eq('id',user.id).maybeSingle();
  if(profileError||!profile)return fail('Je accountgegevens zijn tijdelijk niet beschikbaar.',503);
  if(!user.email_confirmed_at||profile.status!=='approved'||!profile.company_id)return fail('Je account moet zijn goedgekeurd om de bestelgeschiedenis te bekijken.',403);
  const {data:orders,error,count}=await client.from('orders').select(`id,order_number,accepted_at,is_test,user_id,
   order_items(id,drawing_title_snapshot,purpose_name_snapshot,amount_cents,vat_percent,vat_cents,total_cents,currency,agreement_text_snapshot)`,{count:'exact'})
   .eq('company_id',profile.company_id).order('accepted_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*size,page*size-1);
  if(error||!orders)return fail('De bestelgeschiedenis kon niet worden geladen. Probeer opnieuw.',503);
  return Response.json({orders:orders.map(({user_id,...order})=>({...order,ordered_by_you:user_id===user.id})),page,has_more:page*size<(count||0)},{headers});
 }catch{return fail('De bestelgeschiedenis is tijdelijk niet bereikbaar.',503)}
}
