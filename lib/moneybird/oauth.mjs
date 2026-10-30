import {moneybirdId,MoneybirdError} from './contacts.mjs';
// Documented minimum contact scope. Moneybird does not document an OAuth read-only variant.
export const contactScope='sales_invoices';
export function oauthConfig(env=process.env){
 const {MONEYBIRD_CLIENT_ID:clientId,MONEYBIRD_CLIENT_SECRET:clientSecret,MONEYBIRD_ENCRYPTION_KEY:encryptionKey,MONEYBIRD_ADMINISTRATION_ID:administrationId}=env;
 const scope=contactScope;
 if(!clientId||!clientSecret||!encryptionKey||!moneybirdId(administrationId))throw new MoneybirdError('MONEYBIRD_OAUTH_CONFIG');
 const url=new URL(env.APP_URL||'https://eclectic-bublanina-b08cc8.netlify.app');
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new MoneybirdError('MONEYBIRD_OAUTH_CONFIG');
 return {clientId,clientSecret,encryptionKey,administrationId,scope,origin:url.origin,redirectUri:url.origin+'/api/admin/moneybird/oauth/callback'};
}
export function authorizationUrl(config,state,challenge){const url=new URL('https://moneybird.com/oauth/authorize');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:config.scope,state,code_challenge:challenge,code_challenge_method:'S256'}).toString();return url}
export async function exchangeTokens(config,params,previous=null,request=fetch){
 const body=new URLSearchParams({...params,client_id:config.clientId,client_secret:config.clientSecret});
 let response;try{response=await request('https://moneybird.com/oauth/token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)})}catch{throw new MoneybirdError('MONEYBIRD_UNAVAILABLE')}
 if(!response.ok)throw new MoneybirdError(response.status===400||response.status===401?'MONEYBIRD_OAUTH_REJECTED':'MONEYBIRD_UNAVAILABLE');
 let data;try{data=await response.json()}catch{throw new MoneybirdError('MONEYBIRD_RESPONSE')}
 if(typeof data.access_token!=='string'||!data.access_token||data.token_type?.toLowerCase()!=='bearer')throw new MoneybirdError('MONEYBIRD_RESPONSE');
 if(data.scope!=null&&data.scope!==config.scope)throw new MoneybirdError('MONEYBIRD_SCOPE_CHANGED');
 const expiresIn=data.expires_in;
 if(expiresIn!=null&&(!Number.isFinite(expiresIn)||expiresIn<=0))throw new MoneybirdError('MONEYBIRD_RESPONSE');
 const refreshToken=typeof data.refresh_token==='string'&&data.refresh_token?data.refresh_token:previous?.refreshToken||null;
 return {accessToken:data.access_token,refreshToken,expiresAt:expiresIn==null?null:Date.now()+expiresIn*1000,scope:config.scope};
}
export async function verifyAdministration(config,accessToken,request=fetch){
 let response;try{response=await request('https://moneybird.com/api/v2/administrations.json',{method:'GET',headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})}catch{throw new MoneybirdError('MONEYBIRD_UNAVAILABLE')}
 if(!response.ok)throw new MoneybirdError('MONEYBIRD_ACCESS');
 let rows;try{rows=await response.json()}catch{throw new MoneybirdError('MONEYBIRD_RESPONSE')}
 const admin=Array.isArray(rows)&&rows.find(a=>a.id===config.administrationId);if(!admin)throw new MoneybirdError('MONEYBIRD_WRONG_ADMINISTRATION');
 return {id:admin.id,name:typeof admin.name==='string'?admin.name:'Moneybird-administratie'};
}
