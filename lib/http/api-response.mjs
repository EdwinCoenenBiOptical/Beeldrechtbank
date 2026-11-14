export class ApiResponseError extends Error {
 constructor(message,status,code){super(message);this.name='ApiResponseError';this.status=status;this.code=code}
}
/** Read API data without leaking an HTML error page or implying a mutation failed safely. */
export async function readApiResponse(response,{mutation=false}={}){
 const invalid=code=>{
  const detail=`Controlecode: HTTP ${response.status}.`;
  const message=mutation
   ?`De server heeft deze actie niet bevestigd. Controleer eerst de actuele status voordat je opnieuw probeert. ${detail}`
   :`De gegevensdienst geeft tijdelijk geen geldig antwoord. Vernieuw de pagina of probeer later opnieuw. ${detail}`;
  return new ApiResponseError(message,response.status,code);
 };
 const mime=(response.headers.get('content-type')||'').split(';',1)[0].trim().toLowerCase();
 if(response.redirected)throw invalid('API_REDIRECT');
 if(mime!=='application/json'&&!/^application\/[a-z0-9.+-]+\+json$/.test(mime))throw invalid('API_NON_JSON');
 try{return await response.json()}catch{throw invalid('API_INVALID_JSON')}
}
