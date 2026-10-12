import {requireAdmin,connectionConfig,readConnection,publicError} from '../../../../lib/onedrive/server';
export async function GET(){
 const headers={'Cache-Control':'private, no-store'};
 try{const {client}=await requireAdmin();connectionConfig();const saved=await readConnection(client);return Response.json({connected:!!saved,metadata:saved?.metadata||null},{headers})}catch(error){const result=publicError(error);return Response.json({error:result.error},{status:result.status,headers})}
}
