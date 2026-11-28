import 'server-only';
import {moneybirdCredentials} from './credentials.mjs';
import {serviceClient} from '../supabase/service';
import {createMoneybirdReader} from './contacts.mjs';
import {createMoneybirdInvoices} from './invoices.mjs';
import {createMoneybirdContactWriter} from './create-contact.mjs';
import {oauthConfig} from './oauth.mjs';
import {validateEncryptionKey} from './security.mjs';
export type SavedConnection={encrypted_tokens:string|null;administration_id:string|null;administration_name:string|null;scope:string|null;revision:number;connected_at:string|null;reconnect_required:boolean};
export function connectionConfig(){const config=oauthConfig();validateEncryptionKey(config.encryptionKey);return config}
export async function oauthAction(actor:string,action:string,data:Record<string,unknown>={}){
 const {data:result,error}=await serviceClient().rpc('server_moneybird_oauth',{p_actor_id:actor,p_action:action,p_data:data});
 if(error)throw Error(error.message.includes('ADMIN_REQUIRED')?'MONEYBIRD_ADMIN_CHANGED':error.message.includes('INVALID_STATE')?'MONEYBIRD_STATE_INVALID':error.message.includes('CONNECTION_CHANGED')?'MONEYBIRD_CONNECTION_CHANGED':'MONEYBIRD_DATABASE');
 return result;
}
export async function readOAuthConnection(actor:string):Promise<SavedConnection>{return oauthAction(actor,'read')}
async function connectedCredentials(actor:string){return moneybirdCredentials(actor,oauthAction)}

export async function connectedReader(actor:string){return createMoneybirdReader(await connectedCredentials(actor))}
export async function connectedContactCreator(actor:string){return createMoneybirdContactWriter(await connectedCredentials(actor))}

export async function connectedInvoices(actor:string){return createMoneybirdInvoices(await connectedCredentials(actor))}

export async function connectedBilling(actor:string){const credentials=await connectedCredentials(actor);return {invoices:createMoneybirdInvoices(credentials),contacts:createMoneybirdReader(credentials)}}
