import {sameOrigin,currentConnection,publicError,filePath} from '../../../../lib/onedrive/server';
import {serverClient} from '../../../../lib/supabase/server';
import {serviceClient} from '../../../../lib/supabase/service';
import {fetchTestJpeg} from '../../../../lib/onedrive/download.mjs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request){
 try{
  sameOrigin(request);const client=await serverClient();const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return Response.json({error:'Log in om te downloaden.'},{status:401,headers});
  const body=await request.json();if(typeof body?.purpose_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.purpose_id))return Response.json({error:'Kies een geldig gebruiksdoel.'},{status:400,headers});
  const {data:right,error:rightError}=await client.rpc('test_download_right',{p_purpose_id:body.purpose_id});
  if(rightError)return Response.json({error:rightError.message.includes('TEST_RIGHT_REQUIRED')?'Leg eerst een testbestelling vast voor deze tekening en dit gebruiksdoel.':'De testdownload is nog niet beschikbaar. Controleer het SQL-script.'},{status:403,headers});
  const {tokens,metadata}=await currentConnection(serviceClient(),true);
  if(metadata.path!==filePath)throw Error('DOWNLOAD_METADATA_INVALID');
  const bytes=await fetchTestJpeg(tokens.accessToken,metadata);
  // Record an offered file, not proof that the user's browser saved it.
  const {error:recordError}=await serviceClient().rpc('server_record_test_download',{p_user_id:user.id,p_purpose_id:body.purpose_id,p_order_item_id:right.order_item_id,p_byte_count:bytes.length});
  if(recordError)return Response.json({error:'De download kon niet worden geregistreerd. Probeer opnieuw.'},{status:503,headers});
  return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="NVH-001.jpg"','Content-Length':String(bytes.length)}});
 }catch(error){
  const code=error instanceof Error?error.message:'';const result=publicError(error);
  const messages:Record<string,string>={DOWNLOAD_SERVER_CONFIG_REQUIRED:'De downloadservice is nog niet ingesteld. Neem contact op met de beheerder.',FILE_TOO_LARGE:'De testdownload ondersteunt bestanden tot 3 MB.',DOWNLOAD_METADATA_INVALID:'De opgeslagen bestandsgegevens passen niet bij het testbestand. Controleer de OneDrive-koppeling.',DOWNLOAD_REDIRECT_MISSING:'Microsoft gaf geen downloadadres terug.',DOWNLOAD_REDIRECT_INVALID:'Microsoft gaf een ongeldig downloadadres terug.',DOWNLOAD_REDIRECT_UNSAFE:'Het downloadadres voldoet niet aan de beveiligingsvoorwaarden.',DOWNLOAD_HOST_BLOCKED:'Microsoft verwijst naar een downloadserver die nog niet is toegestaan.',DOWNLOAD_REDIRECT_LIMIT:'Microsoft gaf te veel opeenvolgende omleidingen terug.',DOWNLOAD_GRAPH_ERROR:'Microsoft Graph kon het bestand niet leveren.',DOWNLOAD_HTTP_ERROR:'De Microsoft-downloadserver kon het bestand niet leveren.',DOWNLOAD_EMPTY:'Microsoft gaf een leeg bestand terug.',DOWNLOAD_NOT_JPEG:'Het ontvangen bestand heeft geen JPEG-bestandsformaat.'};
  const httpStatus=error instanceof Error&&'httpStatus' in error&&typeof error.httpStatus==='number'?error.httpStatus:null;
  const downloadHost=error instanceof Error&&'downloadHost' in error&&typeof error.downloadHost==='string'?error.downloadHost:null;
  const known=code in messages;
  const detail=known?` Controlecode: ${code}${httpStatus?` (HTTP ${httpStatus})`:''}${downloadHost?` · ${downloadHost}`:''}.`:'';
  // Return only a known stage, status and hostname, NEVER the signed URL or token.
  return Response.json({error:(messages[code]||result.error)+detail,diagnostic:known?{code,http_status:httpStatus,host:downloadHost}:null},{status:result.status,headers});
 }
}
