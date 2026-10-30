import {moneybirdAdmin,originCheck,apiError,headers,fail} from '../../../../../../lib/moneybird/server';
import {oauthAction} from '../../../../../../lib/moneybird/connection';
export async function POST(request:Request){try{originCheck(request);const {user}=await moneybirdAdmin();let data;try{data=await request.json()}catch{return fail('Ongeldige aanvraag.',400)}if(data?.confirmed!==true)return fail('Bevestig het verbreken van de verbinding.',400);await oauthAction(user.id,'disconnect');return Response.json({disconnected:true},{headers})}catch(error){return apiError(error)}}
