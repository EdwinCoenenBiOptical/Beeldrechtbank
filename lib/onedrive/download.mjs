export const maxTestBytes=3*1024*1024;
function downloadError(code,details={}){return Object.assign(new Error(code),details)}
export function trustedDownloadUrl(raw){
 if(typeof raw!=='string')throw downloadError('DOWNLOAD_REDIRECT_MISSING');
 let url;try{url=new URL(raw)}catch{throw downloadError('DOWNLOAD_REDIRECT_INVALID')}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw downloadError('DOWNLOAD_REDIRECT_UNSAFE');
 if(!['.1drv.com','.storage.live.com','.onedrive.live.com'].some(suffix=>url.hostname.endsWith(suffix)))throw downloadError('DOWNLOAD_HOST_BLOCKED',{downloadHost:url.hostname});
 return url.toString();
}
export async function boundedJpeg(response){
 if(!response.ok)throw downloadError('DOWNLOAD_HTTP_ERROR',{httpStatus:response.status});
 if(!response.body)throw downloadError('DOWNLOAD_EMPTY');
 const declared=Number(response.headers.get('content-length'));if(declared>maxTestBytes)throw downloadError('FILE_TOO_LARGE');
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxTestBytes)throw downloadError('FILE_TOO_LARGE');chunks.push(value)}}catch(error){await reader.cancel();throw error}finally{reader.releaseLock()}
 const bytes=Buffer.concat(chunks,size);
 if(size<3)throw downloadError('DOWNLOAD_EMPTY');
 if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw downloadError('DOWNLOAD_NOT_JPEG');
 return bytes;
}
export async function fetchTestJpeg(accessToken,metadata,fetcher=fetch){
 if(!metadata||typeof metadata.itemId!=='string'||typeof metadata.fileName!=='string'||metadata.fileName.toLowerCase()!=='nvh-001.jpg')throw downloadError('DOWNLOAD_METADATA_INVALID');
 if(metadata.size>maxTestBytes)throw downloadError('FILE_TOO_LARGE');
 // The connection belongs to the owner: use the owner's drive directly.
 const url='https://graph.microsoft.com/v1.0/me/drive/items/'+encodeURIComponent(metadata.itemId)+'/content';
 let response=await fetcher(url,{headers:{Authorization:'Bearer '+accessToken},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok&&![301,302,303,307,308].includes(response.status))throw downloadError('DOWNLOAD_GRAPH_ERROR',{httpStatus:response.status});
 for(let hops=0;[301,302,303,307,308].includes(response.status);hops++){
  if(hops>=3)throw downloadError('DOWNLOAD_REDIRECT_LIMIT');
  const target=trustedDownloadUrl(response.headers.get('location'));
  // Authenticate only to Graph. Validate EVERY delivery redirect before fetching.
  response=await fetcher(target,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
 }
 return boundedJpeg(response);
}
