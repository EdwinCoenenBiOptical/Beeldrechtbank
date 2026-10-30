import {apiError,moneybirdAdmin,moneybirdReader,headers} from '../../../../../lib/moneybird/server';
export async function GET(request:Request){
 try{const {user}=await moneybirdAdmin();const reader=await moneybirdReader(user.id);const url=new URL(request.url),id=url.searchParams.get('contact_id');
  if(id)return Response.json({contact:await reader.contact(id)},{headers});
  return Response.json(await reader.search(url.searchParams.get('query')||'',Number(url.searchParams.get('page')||1)),{headers});
 }catch(error){return apiError(error)}
}
