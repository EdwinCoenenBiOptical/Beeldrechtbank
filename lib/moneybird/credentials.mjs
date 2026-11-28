import {randomUUID} from 'node:crypto';
import {oauthConfig,exchangeTokens} from './oauth.mjs';
import {openTokens,sealTokens,validateEncryptionKey} from './security.mjs';
/** Shared by interactive requests and scheduled jobs; refresh uses the same database lease. */
export async function moneybirdCredentials(actor,action,env=process.env){
 const config=oauthConfig(env);validateEncryptionKey(config.encryptionKey);
 const saved=await action(actor,'read');
 if(!saved?.encrypted_tokens||saved.reconnect_required||saved.administration_id!==config.administrationId||saved.scope!==config.scope)throw Error('MONEYBIRD_RECONNECT');
 let tokens=openTokens(saved.encrypted_tokens,config.encryptionKey);
 if(typeof tokens.accessToken!=='string'||!tokens.accessToken||tokens.scope!==config.scope||tokens.expiresAt!==null&&!Number.isFinite(tokens.expiresAt))throw Error('MONEYBIRD_RECONNECT');
 if(tokens.expiresAt!==null&&tokens.expiresAt<Date.now()+60000){
  if(!tokens.refreshToken)throw Error('MONEYBIRD_RECONNECT');
  const owner=randomUUID(),leased=await action(actor,'claim',{revision:saved.revision,owner});
  if(!leased)throw Error('MONEYBIRD_REFRESH_BUSY');
  try{
   tokens=await exchangeTokens(config,{grant_type:'refresh_token',refresh_token:tokens.refreshToken},tokens);
   await action(actor,'refresh',{revision:saved.revision,owner,encrypted_tokens:sealTokens(tokens,config.encryptionKey)});
  }catch(error){await action(actor,'release',{revision:saved.revision,owner,reconnect:error instanceof Error&&['MONEYBIRD_OAUTH_REJECTED','MONEYBIRD_SCOPE_CHANGED'].includes(error.message)}).catch(()=>{});throw error;}
 }
 return {token:tokens.accessToken,administrationId:config.administrationId};
}
