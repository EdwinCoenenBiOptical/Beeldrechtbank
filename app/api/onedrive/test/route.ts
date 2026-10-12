import {requireAdmin,sameOrigin,testConnection,publicError} from '../../../../lib/onedrive/server';
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'};
 try{const {client}=await requireAdmin();sameOrigin(request);return Response.json({metadata:await testConnection(client)},{headers})}catch(error){const result=publicError(error);return Response.json({error:result.error},{status:result.status,headers})}
}
