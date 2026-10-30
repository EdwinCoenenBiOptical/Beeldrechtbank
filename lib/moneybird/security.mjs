import {createCipheriv,createDecipheriv,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
function key(value){const bytes=Buffer.from(value||'','base64');if(bytes.length!==32||bytes.toString('base64')!==value)throw Error('MONEYBIRD_ENCRYPTION_CONFIG');return bytes}
export function sealTokens(tokens,secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);cipher.setAAD(Buffer.from('beeldrechtbank-moneybird-tokens-v1'));return encrypt(cipher,iv,tokens)}
function encrypt(cipher,iv,tokens){const bytes=Buffer.concat([cipher.update(JSON.stringify(tokens),'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.')}
export function openTokens(value,secret){try{if(typeof value!=='string'||value.length>60000)throw Error();const [version,iv,tag,data,...rest]=value.split('.');if(version!=='v1'||rest.length)throw Error();const decipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from('beeldrechtbank-moneybird-tokens-v1'));decipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8'))}catch{throw Error('MONEYBIRD_RECONNECT')}}
export const newState=()=>randomBytes(32).toString('base64url');
export const stateHash=value=>createHash('sha256').update(value).digest('hex');
export function equalState(a,b){if(typeof a!=='string'||typeof b!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(a)||!/^[A-Za-z0-9_-]{43}$/.test(b))return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b))}
export const pkceChallenge=verifier=>createHash('sha256').update(verifier).digest('base64url');
export function validateEncryptionKey(value){key(value)}
