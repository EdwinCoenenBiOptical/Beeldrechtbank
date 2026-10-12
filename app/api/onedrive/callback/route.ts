import {cookies} from 'next/headers';import {NextResponse} from 'next/server';
import {connectionConfig,requireAdmin,oauthCookie,tokensFromMicrosoft,graphMetadata,readConnection,saveConnection} from '../../../../lib/onedrive/server';
import {open,validState} from '../../../../lib/onedrive/security.mjs';
function finish(result:string){const response=new NextResponse(null,{status:303,headers:{Location:'/?onedrive='+result+'#account','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});response.cookies.set(oauthCookie,'',{httpOnly:true,secure:true,sameSite:'lax',path:'/api/onedrive',maxAge:0});return response}
export async function GET(request:Request){
 const url=new URL(request.url);
 try{
  const {client,user}=await requireAdmin();const config=connectionConfig();
  const raw=(await cookies()).get(oauthCookie)?.value;if(!raw)return finish('invalid');
  const state=open(raw,config.secret,'oauth');
  if(!validState(state,url.searchParams.get('state'),user.id))return finish('invalid');
  if(url.searchParams.has('error'))return finish('cancelled');
  const code=url.searchParams.get('code');if(!code)return finish('invalid');
  const saved=await readConnection(client);
  const tokens=await tokensFromMicrosoft(new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:config.redirectUri,code_verifier:state.verifier}));
  const metadata=await graphMetadata(tokens.accessToken);
  await saveConnection(client,tokens,metadata,saved?.revision||0);
  return finish('connected');
 }catch(error){const code=error instanceof Error?error.message:'';return finish(code==='FILE_UNAVAILABLE'?'file_missing':code==='MICROSOFT_AUTH_FAILED'?'microsoft_error':'failed')}
}
