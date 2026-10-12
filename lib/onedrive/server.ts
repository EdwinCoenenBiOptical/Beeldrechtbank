import {serverClient} from '../supabase/server';
import {open,seal} from './security.mjs';
export const oauthCookie='br_onedrive_oauth';
const graph='https://graph.microsoft.com/v1.0';
export const scopes='openid profile offline_access https://graph.microsoft.com/Files.Read https://graph.microsoft.com/User.Read';
export const filePath='Rechtbanktekeningen/BeeldRechtbank/NVH-001.jpg';
export function connectionConfig(){
 const clientId=process.env.ONEDRIVE_CLIENT_ID,secret=process.env.ONEDRIVE_CLIENT_SECRET;
 const appUrl=process.env.APP_URL||'https://eclectic-bublanina-b08cc8.netlify.app';
 if(!clientId||!secret)throw Error('CONFIG_REQUIRED');
 const origin=new URL(appUrl).origin;
 return {clientId,secret,origin,redirectUri:origin+'/api/onedrive/callback'};
}
export async function requireAdmin(){
 const client=await serverClient();const {data:{user},error}=await client.auth.getUser();
 if(error||!user)throw Error('LOGIN_REQUIRED');
 const {data:admin,error:adminError}=await client.rpc('is_onedrive_admin');
 if(adminError)throw Error('DATABASE_REQUIRED');if(admin!==true)throw Error('ADMIN_REQUIRED');
 return {client,user};
}
export function sameOrigin(request:Request){const origin=request.headers.get('origin');if(!origin||origin!==connectionConfig().origin)throw Error('INVALID_ORIGIN')}
type Tokens={accessToken:string;refreshToken:string;expiresAt:number};
export type Metadata={accountName:string;accountId:string;driveId:string;itemId:string;fileName:string;size:number;path:string;verifiedAt:string};
type Connection={encrypted_tokens:string;metadata:Metadata;revision:number;connected_at:string};
export async function readConnection(client:Awaited<ReturnType<typeof serverClient>>){const {data,error}=await client.rpc('read_onedrive_connection');if(error)throw Error('DATABASE_REQUIRED');return data as Connection|null}
export async function saveConnection(client:Awaited<ReturnType<typeof serverClient>>,tokens:Tokens,metadata:Metadata,revision:number){
 const {data,error}=await client.rpc('save_onedrive_connection',{p_encrypted_tokens:seal(tokens,connectionConfig().secret,'tokens'),p_metadata:metadata,p_expected_revision:revision});
 if(error)throw Error('SAVE_FAILED');return Number(data);
}
export async function tokensFromMicrosoft(body:URLSearchParams,oldRefresh?:string):Promise<Tokens>{
 const config=connectionConfig();body.set('client_id',config.clientId);body.set('client_secret',config.secret);
 const response=await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('MICROSOFT_AUTH_FAILED');const data=await response.json();
 const refresh=data.refresh_token||oldRefresh;
 if(typeof data.access_token!=='string'||typeof refresh!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw Error('MICROSOFT_AUTH_FAILED');
 return {accessToken:data.access_token,refreshToken:refresh,expiresAt:Date.now()+data.expires_in*1000};
}
export async function graphMetadata(accessToken:string):Promise<Metadata>{
 const headers={Authorization:'Bearer '+accessToken};
 const path=filePath.split('/').map(encodeURIComponent).join('/');
 const [accountResponse,fileResponse]=await Promise.all([
 fetch(graph+'/me?$select=id,displayName',{headers,cache:'no-store',signal:AbortSignal.timeout(15000)}),
 fetch(graph+'/me/drive/root:/'+path+'?$select=id,name,size,file,parentReference',{headers,cache:'no-store',signal:AbortSignal.timeout(15000)})]);
 if(!accountResponse.ok)throw Error('ACCOUNT_UNAVAILABLE');if(!fileResponse.ok)throw Error('FILE_UNAVAILABLE');
 const account=await accountResponse.json(),file=await fileResponse.json();
 if(typeof account.id!=='string'||typeof file.id!=='string'||typeof file.parentReference?.driveId!=='string'||!file.file||file.file.mimeType!=='image/jpeg'||!Number.isSafeInteger(file.size)||file.size<1)throw Error('FILE_UNAVAILABLE');
 return {accountName:account.displayName||'Microsoft-account',accountId:account.id,driveId:file.parentReference.driveId,itemId:file.id,fileName:file.name,size:file.size,path:filePath,verifiedAt:new Date().toISOString()};
}
export async function testConnection(client:Awaited<ReturnType<typeof serverClient>>){
 const saved=await readConnection(client);if(!saved)throw Error('NOT_CONNECTED');
 let tokens:Tokens=open(saved.encrypted_tokens,connectionConfig().secret,'tokens');
 if(typeof tokens.accessToken!=='string'||typeof tokens.refreshToken!=='string'||!Number.isFinite(tokens.expiresAt))throw Error('RECONNECT_REQUIRED');
 let revision=saved.revision;
 if(tokens.expiresAt<Date.now()+60000){tokens=await tokensFromMicrosoft(new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refreshToken,scope:scopes}),tokens.refreshToken);revision=await saveConnection(client,tokens,saved.metadata,revision);}
 const metadata=await graphMetadata(tokens.accessToken);
 // A refreshed connection must still point to the original owner's Microsoft account.
 if(metadata.accountId!==saved.metadata.accountId)throw Error('ACCOUNT_CHANGED');
 await saveConnection(client,tokens,metadata,revision);return metadata;
}
export function publicError(error:unknown){
 const code=error instanceof Error?error.message:'';
 const messages:Record<string,string>={LOGIN_REQUIRED:'Log in om de OneDrive-koppeling te beheren.',ADMIN_REQUIRED:'Alleen de beheerder mag deze koppeling beheren.',DATABASE_REQUIRED:'Voer eerst het SQL-script voor de OneDrive-koppeling uit.',CONFIG_REQUIRED:'De Microsoft-appgegevens zijn nog niet beschikbaar. Controleer de Netlify-variabelen en deployment.',INVALID_ORIGIN:'Deze aanvraag komt niet van de ingestelde website.',NOT_CONNECTED:'OneDrive is nog niet verbonden.',MICROSOFT_AUTH_FAILED:'Microsoft kon de verbinding niet bevestigen. Controleer de appinstellingen en probeer opnieuw.',FILE_UNAVAILABLE:'Het testbestand is niet gevonden of niet leesbaar. Controleer het account en het pad.',ACCOUNT_UNAVAILABLE:'Het Microsoft-account kon niet worden gelezen.',SAVE_FAILED:'De verbinding kon niet veilig worden opgeslagen. Probeer opnieuw.',RECONNECT_REQUIRED:'Verbind OneDrive opnieuw.',ACCOUNT_CHANGED:'Het Microsoft-account is gewijzigd. Verbind opnieuw.'};
 return {error:messages[code]||'De OneDrive-koppeling kon niet worden gecontroleerd. Verbind opnieuw of probeer later opnieuw.',status:code==='LOGIN_REQUIRED'?401:code==='ADMIN_REQUIRED'||code==='INVALID_ORIGIN'?403:503};
}
