export const maxTestBytes=3*1024*1024;
export function trustedDownloadUrl(raw){if(typeof raw!=='string')throw Error('DOWNLOAD_UNAVAILABLE');let url;try{url=new URL(raw)}catch{throw Error('DOWNLOAD_UNAVAILABLE')};if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!['.1drv.com','.storage.live.com','.onedrive.live.com'].some(suffix=>url.hostname.endsWith(suffix)))throw Error('DOWNLOAD_UNAVAILABLE');return url.toString()}
export async function boundedJpeg(response){
 if(!response.ok||!response.body)throw Error('DOWNLOAD_UNAVAILABLE');
 const declared=Number(response.headers.get('content-length'));if(declared>maxTestBytes)throw Error('FILE_TOO_LARGE');
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxTestBytes)throw Error('FILE_TOO_LARGE');chunks.push(value)}}catch(error){await reader.cancel();throw error}finally{reader.releaseLock()}
 const bytes=Buffer.concat(chunks,size);if(size<3||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error('DOWNLOAD_UNAVAILABLE');return bytes;
}
export async function fetchTestJpeg(accessToken,metadata,fetcher=fetch){
 if(!metadata||typeof metadata.driveId!=='string'||typeof metadata.itemId!=='string'||metadata.fileName!=='NVH-001.jpg')throw Error('DOWNLOAD_UNAVAILABLE');
 if(metadata.size>maxTestBytes)throw Error('FILE_TOO_LARGE');
 const url='https://graph.microsoft.com/v1.0/drives/'+encodeURIComponent(metadata.driveId)+'/items/'+encodeURIComponent(metadata.itemId)+'/content';
 let response=await fetcher(url,{headers:{Authorization:'Bearer '+accessToken},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if([301,302,303,307,308].includes(response.status)){
  const target=trustedDownloadUrl(response.headers.get('location'));
  // Never pass the Graph bearer token to a download host; do not follow additional redirects.
  response=await fetcher(target,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 }
 return boundedJpeg(response);
}
