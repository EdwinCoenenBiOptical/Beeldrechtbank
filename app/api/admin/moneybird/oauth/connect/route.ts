import {NextResponse} from 'next/server';
import {moneybirdAdmin,originCheck,apiError} from '../../../../../../lib/moneybird/server';
import {connectionConfig,oauthAction} from '../../../../../../lib/moneybird/connection';
import {newState,stateHash,pkceChallenge} from '../../../../../../lib/moneybird/security.mjs';
import {authorizationUrl} from '../../../../../../lib/moneybird/oauth.mjs';
export async function POST(request:Request){
 try{originCheck(request);const {user}=await moneybirdAdmin();const config=connectionConfig();
  if(request.headers.get('origin')!==config.origin)throw Error('MONEYBIRD_ORIGIN');
  const state=newState(),verifier=newState();await oauthAction(user.id,'start',{state_hash:stateHash(state),verifier,administration_id:config.administrationId,scope:config.scope});
  const response=NextResponse.redirect(authorizationUrl(config,state,pkceChallenge(verifier)),303);response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
  response.cookies.set('br_moneybird_oauth',state,{httpOnly:true,secure:true,sameSite:'lax',path:'/api/admin/moneybird/oauth',maxAge:600});return response;
 }catch(error){return apiError(error)}
}
