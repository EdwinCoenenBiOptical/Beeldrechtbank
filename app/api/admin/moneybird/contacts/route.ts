import {apiError,moneybirdAdmin,moneybirdReader,headers} from '../../../../../lib/moneybird/server';
export async function GET(request:Request){
 try{await moneybirdAdmin();const url=new URL(request.url),id=url.searchParams.get('contact_id');
  if(id)return Response.json({contact:await moneybirdReader().contact(id)},{headers});
  return Response.json(await moneybirdReader().search(url.searchParams.get('query')||'',Number(url.searchParams.get('page')||1)),{headers});
 }catch(error){return apiError(error)}
}
