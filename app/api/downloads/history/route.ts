import {serverClient} from '../../../../lib/supabase/server';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
 const raw=new URL(request.url).searchParams.get('page')||'1';if(!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>100000)return Response.json({error:'Ongeldige pagina.'},{status:400,headers});const page=Number(raw),size=10;
 try{
  const client=await serverClient();const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return Response.json({error:'Log in om downloads te bekijken.'},{status:401,headers});
  const {data:profile,error:profileError}=await client.from('profiles').select('status,company_id').eq('id',user.id).maybeSingle();if(profileError||!profile)return Response.json({error:'Accountgegevens zijn tijdelijk niet beschikbaar.'},{status:503,headers});if(profile.status!=='approved'||!profile.company_id||!user.email_confirmed_at)return Response.json({error:'Goedkeuring is vereist.'},{status:403,headers});
  const {data,error,count}=await client.from('download_events').select('id,offered_at,file_name,byte_count,is_test,status,user_id,order_items!inner(drawing_title_snapshot,purpose_name_snapshot,company_id)',{count:'exact'}).eq('order_items.company_id',profile.company_id).order('offered_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*size,page*size-1);
  if(error)return Response.json({error:'Downloadgeschiedenis kon niet worden geladen.'},{status:503,headers});return Response.json({downloads:(data||[]).map(({user_id,...event})=>({...event,downloaded_by_you:user_id===user.id})),page,has_more:page*size<(count||0)},{headers});
 }catch{return Response.json({error:'Downloadgeschiedenis is tijdelijk niet bereikbaar.'},{status:503,headers})}
}
