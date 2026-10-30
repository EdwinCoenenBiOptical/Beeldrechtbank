import 'server-only';
import {randomUUID} from 'node:crypto';
import {serviceClient} from '../supabase/service';
import {createMoneybirdReader} from './contacts.mjs';
import {oauthConfig,exchangeTokens} from './oauth.mjs';
import {openTokens,sealTokens,validateEncryptionKey} from './security.mjs';
export type SavedConnection={encrypted_tokens:string|null;administration_id:string|null;administration_name:string|null;scope:string|null;revision:number;connected_at:string|null;reconnect_required:boolean};
export function connectionConfig(){const config=oauthConfig();validateEncryptionKey(config.encryptionKey);return config}
export async function oauthAction(actor:string,action:string,data:Record<string,unknown>={}){
 const {data:result,error}=await serviceClient().rpc('server_moneybird_oauth',{p_actor_id:actor,p_action:action,p_data:data});
 if(error)throw Error(error.message.includes('ADMIN_REQUIRED')?'MONEYBIRD_ADMIN_CHANGED':error.message.includes('INVALID_STATE')?'MONEYBIRD_STATE_INVALID':error.message.includes('CONNECTION_CHANGED')?'MONEYBIRD_CONNECTION_CHANGED':'MONEYBIRD_DATABASE');
 return result;
}
export async function readOAuthConnection(actor:string):Promise<SavedConnection>{return oauthAction(actor,'read')}
export async function connectedReader(actor:string){
 const config=connectionConfig(),saved=await readOAuthConnection(actor);
 if(!saved?.encrypted_tokens||saved.reconnect_required)throw Error('MONEYBIRD_RECONNECT');
 if(saved.administration_id!==config.administrationId||saved.scope!==config.scope)throw Error('MONEYBIRD_RECONNECT');
 let tokens=openTokens(saved.encrypted_tokens,config.encryptionKey);
 if(typeof tokens.accessToken!=='string'||!tokens.accessToken||tokens.scope!==config.scope||tokens.expiresAt!==null&&!Number.isFinite(tokens.expiresAt))throw Error('MONEYBIRD_RECONNECT');
 if(tokens.expiresAt!==null&&tokens.expiresAt<Date.now()+60000){
  if(!tokens.refreshToken)throw Error('MONEYBIRD_RECONNECT');
  const owner=randomUUID();const leased=await oauthAction(actor,'claim',{revision:saved.revision,owner});if(!leased)throw Error('MONEYBIRD_REFRESH_BUSY');
  try{
   tokens=await exchangeTokens(config,{grant_type:'refresh_token',refresh_token:tokens.refreshToken},tokens);
   await oauthAction(actor,'refresh',{revision:saved.revision,owner,encrypted_tokens:sealTokens(tokens,config.encryptionKey)});
  }catch(error){await oauthAction(actor,'release',{revision:saved.revision,owner,reconnect:error instanceof Error&&['MONEYBIRD_OAUTH_REJECTED','MONEYBIRD_SCOPE_CHANGED'].includes(error.message)}).catch(()=>{});throw error}
 }
 return createMoneybirdReader({token:tokens.accessToken,administrationId:config.administrationId});
}
