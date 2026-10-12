import {timingSafeEqual} from 'node:crypto';
export const registrationRecipient='rechtbanktekeningen@nicolevandenhout.nl';
function field(value){return String(value??'').replace(/[\r\n\0]/g,' ').trim()}
export function validJobSecret(provided,expected){if(typeof provided!=='string'||typeof expected!=='string'||expected.length<32)return false;const a=Buffer.from(provided),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)}
export function registrationMail(record,from){
 return {from,to:[registrationRecipient],subject:'Nieuwe aanmelding voor Beeldrechtbank',text:[
 'Er is een nieuwe aanmelding voor Beeldrechtbank.','',
 'Naam: '+field(record.full_name),'E-mailadres: '+field(record.email),
 'Bedrijf: '+field(record.company_name),'KvK-nummer: '+field(record.kvk_number),'',
 'De aanvraag wacht op jouw beoordeling. Een e-mailadres moet ook bevestigd zijn voordat het account kan worden goedgekeurd.',
 'Bekijk de aanmelding in Supabase:',
 'https://supabase.com/dashboard/project/wilemykpwwznghhspidv/auth/users','',
 'Deze notificatie keurt het account niet automatisch goed.'
 ].join('\n')};
}
export async function deliverRegistration(record,{from,apiKey},fetcher=fetch){
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'registration-'+record.id},body:JSON.stringify(registrationMail(record,from)),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('MAIL_PROVIDER_REJECTED');const body=await response.json();if(typeof body.id!=='string'||!body.id)throw Error('MAIL_PROVIDER_INVALID_RESPONSE');return body.id;
}
