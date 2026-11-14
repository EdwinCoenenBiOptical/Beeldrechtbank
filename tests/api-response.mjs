import {test} from 'node:test';import assert from 'node:assert/strict';
import {readApiResponse,ApiResponseError} from '../lib/http/api-response.mjs';
test('API reader handles platform HTML, redirects and malformed JSON without exposing page contents',async()=>{
 for(const status of [200,403,404,429,500,502,503]){
  await assert.rejects(readApiResponse(new Response('<!DOCTYPE html><html>Private platform details</html>',{status,headers:{'Content-Type':'text/html'}})),e=>e instanceof ApiResponseError&&e.status===status&&e.code==='API_NON_JSON'&&!e.message.includes('Private')&&!e.message.includes('Unexpected token')&&e.message.includes('Vernieuw'));
 }
 await assert.rejects(readApiResponse(new Response('<!DOCTYPE html>',{headers:{'Content-Type':'application/json'}})),e=>e.code==='API_INVALID_JSON');
 await assert.rejects(readApiResponse({status:200,redirected:true,headers:new Headers({'Content-Type':'application/json'}),json:async()=>({})}),e=>e.code==='API_REDIRECT');
 assert.deepEqual(await readApiResponse(Response.json({error:'Log opnieuw in.'},{status:401})),{error:'Log opnieuw in.'});
 assert.deepEqual(await readApiResponse(new Response('{"ok":true}',{headers:{'Content-Type':'application/problem+json; charset=utf-8'}})),{ok:true});
});
test('uncertain mutation response tells the operator to check status instead of blindly repeating an invoice action',async()=>{
 await assert.rejects(readApiResponse(new Response('Bad gateway',{status:502,headers:{'Content-Type':'text/html'}}),{mutation:true}),e=>e instanceof ApiResponseError&&e.message.includes('actie niet bevestigd')&&e.message.includes('Controleer eerst de actuele status'));
});
