import {requireAdmin,sameOrigin,currentConnection,publicError,filePath} from '../../../../lib/onedrive/server';
import {fetchTestJpeg} from '../../../../lib/onedrive/download.mjs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request){
 try{
  const {client}=await requireAdmin();sameOrigin(request);
  const body=await request.json();if(typeof body?.purpose_id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.purpose_id))return Response.json({error:'Kies een geldig gebruiksdoel.'},{status:400,headers});
  const {error:rightError}=await client.rpc('test_download_right',{p_purpose_id:body.purpose_id});
  if(rightError)return Response.json({error:rightError.message.includes('TEST_RIGHT_REQUIRED')?'Leg eerst een testbestelling vast voor deze tekening en dit gebruiksdoel.':'De testdownload is nog niet beschikbaar. Controleer het SQL-script.'},{status:403,headers});
  const {tokens,metadata}=await currentConnection(client);
  if(metadata.path!==filePath)throw Error('DOWNLOAD_UNAVAILABLE');
  const bytes=await fetchTestJpeg(tokens.accessToken,metadata);
  // Record an offered file, not proof that the user's browser saved it.
  const {error:recordError}=await client.rpc('record_test_download',{p_purpose_id:body.purpose_id,p_byte_count:bytes.length});
  if(recordError)return Response.json({error:'De download kon niet worden geregistreerd. Probeer opnieuw.'},{status:503,headers});
  return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/jpeg','Content-Disposition':'attachment; filename="NVH-001.jpg"','Content-Length':String(bytes.length)}});
 }catch(error){const code=error instanceof Error?error.message:'';const result=publicError(error);return Response.json({error:code==='FILE_TOO_LARGE'?'De testdownload ondersteunt bestanden tot 3 MB.':code==='DOWNLOAD_UNAVAILABLE'?'Het JPEG-testbestand kon niet veilig worden opgehaald.':result.error},{status:result.status,headers})}
}
