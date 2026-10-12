import {serverClient} from '../../../../lib/supabase/server';
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store'},url=new URL(request.url),search=url.searchParams.get('q')||'',include=url.searchParams.get('include');
 if(search.length>200||include&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(include))return Response.json({error:'Ongeldige zoekopdracht.'},{status:400,headers});
 try{const client=await serverClient();const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return Response.json({error:'Log in met je beheeraccount.'},{status:401,headers});const {data,error}=await client.rpc('admin_company_options',{p_search:search,p_include:include});if(error)return Response.json({error:error.message.includes('ADMIN_REQUIRED')?'Alleen de beheerder kan bedrijven kiezen.':'De bedrijvenlijst is nog niet beschikbaar. Controleer script 008.'},{status:error.message.includes('ADMIN_REQUIRED')?403:503,headers});return Response.json(data,{headers})}catch{return Response.json({error:'De bedrijvenlijst is tijdelijk niet bereikbaar.'},{status:503,headers})}
}
