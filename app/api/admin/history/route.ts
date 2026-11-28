import {requireAdmin} from '../../../../lib/onedrive/server';
import {serviceClient} from '../../../../lib/supabase/service';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,kind=params.get('kind'),raw=params.get('page')||'1';
 if(!['orders','downloads'].includes(kind||'')||!/^\d+$/.test(raw)||Number(raw)<1||Number(raw)>100000)return Response.json({error:'Ongeldig overzicht.'},{status:400,headers});
 try{
  const {user}=await requireAdmin(); // Never use the service role before verifying the requesting administrator.
  const client=serviceClient(),page=Number(raw),size=10;
  const query=kind==='orders'
   ?client.from('orders').select('id,order_number,accepted_at,is_test,user_id,customer_reference,company_name_snapshot,order_items(id,drawing_id,purpose_id,drawing_title_snapshot,purpose_name_snapshot,amount_cents,vat_percent,vat_cents,total_cents,currency,agreement_text_snapshot)',{count:'exact'}).order('accepted_at',{ascending:false})
   :client.from('download_events').select('id,offered_at,file_name,byte_count,is_test,status,user_id,order_items!inner(drawing_id,drawing_title_snapshot,purpose_name_snapshot,company_id)',{count:'exact'}).order('offered_at',{ascending:false});
  const {data,error,count}=await query.order('id',{ascending:false}).range((page-1)*size,page*size-1);
  if(error||!data)throw Error('HISTORY_UNAVAILABLE');
  const ids=[...new Set(data.map((row:any)=>row.user_id))];
  const {data:people,error:peopleError}=ids.length?await client.from('profiles').select('id,full_name').in('id',ids):{data:[],error:null};
  if(peopleError)throw Error('HISTORY_UNAVAILABLE');
  const names=new Map((people||[]).map(p=>[p.id,p.full_name]));
  const companyIds=kind==='downloads'?[...new Set(data.map((row:any)=>row.order_items?.company_id).filter(Boolean))]:[];
  const {data:companies,error:companyError}=companyIds.length?await client.from('companies').select('id,name').in('id',companyIds):{data:[],error:null};
  if(companyError)throw Error('HISTORY_UNAVAILABLE');
  const companyNames=new Map((companies||[]).map(c=>[c.id,c.name]));
  const rows=data.map(({user_id,...row}:any)=>kind==='orders'?{...row,ordered_by_you:user_id===user.id,ordered_by_name:names.get(user_id)||'Onbekende gebruiker'}:{...row,company_name:companyNames.get(row.order_items?.company_id),downloaded_by_you:user_id===user.id,downloaded_by_name:names.get(user_id)||'Onbekende gebruiker'});
  return Response.json({[kind==='orders'?'orders':'downloads']:rows,page,has_more:page*size<(count||0)},{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  return Response.json({error:code==='LOGIN_REQUIRED'?'Log in met je beheeraccount.':code==='ADMIN_REQUIRED'?'Dit overzicht is alleen voor beheerders.':'Het beheeroverzicht is tijdelijk niet beschikbaar.'},{status:code==='LOGIN_REQUIRED'?401:code==='ADMIN_REQUIRED'?403:503,headers});
 }
}
