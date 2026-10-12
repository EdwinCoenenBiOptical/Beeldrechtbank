import {NextResponse} from 'next/server';
import {connectionConfig,requireAdmin,sameOrigin,oauthCookie,scopes,publicError} from '../../../../lib/onedrive/server';
import {newOAuthState,challenge,seal} from '../../../../lib/onedrive/security.mjs';
export async function POST(request:Request){
 try{
  const {user}=await requireAdmin();sameOrigin(request);const config=connectionConfig(),state=newOAuthState(user.id);
  const url=new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  url.search=new URLSearchParams({client_id:config.clientId,response_type:'code',redirect_uri:config.redirectUri,response_mode:'query',scope:scopes,state:state.state,code_challenge:challenge(state.verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
  const response=NextResponse.redirect(url,303);response.headers.set('Cache-Control','no-store');
  response.cookies.set(oauthCookie,seal(state,config.secret,'oauth'),{httpOnly:true,secure:config.origin.startsWith('https:'),sameSite:'lax',path:'/api/onedrive',maxAge:600});return response;
 }catch(error){const result=publicError(error);return Response.json({error:result.error},{status:result.status,headers:{'Cache-Control':'no-store'}})}
}
