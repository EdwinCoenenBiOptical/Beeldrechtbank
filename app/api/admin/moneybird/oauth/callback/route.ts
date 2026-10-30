import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {moneybirdAdmin} from '../../../../../../lib/moneybird/server';
import {connectionConfig,oauthAction} from '../../../../../../lib/moneybird/connection';
import {equalState,stateHash,sealTokens} from '../../../../../../lib/moneybird/security.mjs';
import {exchangeTokens,verifyAdministration} from '../../../../../../lib/moneybird/oauth.mjs';
function finish(result:string){const response=new NextResponse(null,{status:303,headers:{Location:'/?moneybird='+result+'#bedrijven','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});response.cookies.set('br_moneybird_oauth','',{httpOnly:true,secure:true,sameSite:'lax',path:'/api/admin/moneybird/oauth',maxAge:0});return response}
export async function GET(request:Request){
 try{
  const {user}=await moneybirdAdmin(),config=connectionConfig(),url=new URL(request.url),cookie=(await cookies()).get('br_moneybird_oauth')?.value,state=url.searchParams.get('state');
  if(!equalState(cookie,state))return finish('invalid');
  const saved=await oauthAction(user.id,'consume',{state_hash:stateHash(state!)});
  if(saved.administration_id!==config.administrationId||saved.scope!==config.scope)return finish('invalid');
  if(url.searchParams.has('error'))return finish('cancelled');
  const code=url.searchParams.get('code');if(!code||code.length>4000)return finish('invalid');
  const tokens=await exchangeTokens(config,{grant_type:'authorization_code',code,redirect_uri:config.redirectUri,code_verifier:saved.verifier});
  const admin=await verifyAdministration(config,tokens.accessToken);
  await oauthAction(user.id,'connect',{state_hash:stateHash(state!),administration_id:admin.id,administration_name:admin.name,scope:config.scope,encrypted_tokens:sealTokens(tokens,config.encryptionKey)});
  return finish('connected');
 }catch(error){const code=error instanceof Error?error.message:'';return finish(code==='MONEYBIRD_WRONG_ADMINISTRATION'?'wrong_administration':code==='MONEYBIRD_SCOPE_CHANGED'?'scope_changed':code==='MONEYBIRD_STATE_INVALID'?'invalid':'failed')}
}
