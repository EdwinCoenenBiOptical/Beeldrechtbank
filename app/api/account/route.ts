import { serverClient } from '../../../lib/supabase/server';
import { supabaseConfig } from '../../../lib/supabase/config';
export async function GET() {
  const headers = {'Cache-Control': 'private, no-store'};
  if (!supabaseConfig()) return Response.json({error:'De accountdienst is nog niet ingesteld.'},{status:503,headers});
  try {
    const client = await serverClient();
    const {data: {user}, error: authError} = await client.auth.getUser();
    if (authError || !user) return Response.json({error:'Log opnieuw in.'},{status:401,headers});
    const {data: profile, error} = await client.from('profiles')
      .select('full_name,requested_company_name,requested_kvk,status,company_id').eq('id',user.id).maybeSingle();
    if (error || !profile) return Response.json({error:'Je accountgegevens zijn nog niet beschikbaar. Neem contact op met de beheerder.'},{status:503,headers});
    const {data:company,error:companyError}=profile.status==='approved'&&profile.company_id?await client.from('companies').select('name,kvk_number,customer_number').eq('id',profile.company_id).maybeSingle():{data:null,error:null};
    if(profile.status==='approved'&&profile.company_id&&(companyError||!company))return Response.json({error:'Het gekoppelde bedrijf kon niet worden geladen. Probeer opnieuw.'},{status:503,headers});
    const {data:onedriveAdmin,error:adminCheckError} = await client.rpc('is_onedrive_admin');
    return Response.json({email:user.email,profile,company,is_onedrive_admin:!adminCheckError&&onedriveAdmin===true,onedrive_admin_check_error:adminCheckError?'De OneDrive-beheerrechten konden niet worden gecontroleerd. Probeer de pagina opnieuw te laden.':null,onedrive_admin_check_code:adminCheckError?.code||null},{headers});
  } catch {
    return Response.json({error:'De accountdienst is tijdelijk niet bereikbaar. Probeer opnieuw.'},{status:503,headers});
  }
}
