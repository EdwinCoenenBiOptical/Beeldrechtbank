import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {trustedDownloadUrl,fetchTestJpeg,boundedJpeg,maxTestBytes} from '../lib/onedrive/download.mjs';
const jpeg=new Uint8Array([255,216,255,224,0,0,255,217]);
test('protected JPEG fetch limits size and keeps Graph token off delivery hosts',async()=>{
 assert.equal(trustedDownloadUrl('https://public.dm.files.1drv.com/test'),'https://public.dm.files.1drv.com/test');
 assert.equal(trustedDownloadUrl('https://my.microsoftpersonalcontent.com/test'),'https://my.microsoftpersonalcontent.com/test');
 for(const url of ['http://public.dm.files.1drv.com/test','https://evil.example/test','https://my.microsoftpersonalcontent.com.evil.example/test','https://other.microsoftpersonalcontent.com/test','http://my.microsoftpersonalcontent.com/test','https://files.1drv.com.evil.example/test','https://user:pass@files.1drv.com/test','https://files.1drv.com:444/test'])assert.throws(()=>trustedDownloadUrl(url));
 let requests=[];const bytes=await fetchTestJpeg('fictional-token',{driveId:'drive',itemId:'item',fileName:'NVH-001.jpg',size:jpeg.length},async(url,options)=>{requests.push({url,options});return requests.length===1?new Response(null,{status:302,headers:{location:'https://public.dm.files.1drv.com/test'}}):new Response(jpeg)});
 assert.deepEqual(new Uint8Array(bytes),jpeg);assert.equal(requests[0].options.headers.Authorization,'Bearer fictional-token');assert.equal(requests[1].options.headers,undefined);assert.equal(requests[1].options.redirect,'manual');assert.ok(requests[0].url.includes('/me/drive/items/item/content'));
 let hops=0;
 await fetchTestJpeg('token',{itemId:'item',fileName:'NVH-001.JPG',size:jpeg.length},async(url,options)=>{
  hops++;if(hops===1)return new Response(null,{status:302,headers:{location:'https://first.files.1drv.com/test'}});
  assert.equal(options.headers,undefined);return hops===2?new Response(null,{status:302,headers:{location:'https://my.microsoftpersonalcontent.com/test'}}):new Response(jpeg);
 });assert.equal(hops,3);
 await assert.rejects(fetchTestJpeg('token',{itemId:'item',fileName:'NVH-001.jpg',size:1},async()=>new Response(null,{status:403})),error=>error.message==='DOWNLOAD_GRAPH_ERROR'&&error.httpStatus===403);
 await assert.rejects(fetchTestJpeg('token',{itemId:'item',fileName:'NVH-001.jpg',size:1},async()=>new Response(null,{status:302,headers:{location:'https://loop.files.1drv.com/test'}})),/DOWNLOAD_REDIRECT_LIMIT/);

 await assert.rejects(boundedJpeg(new Response('not an image')),/DOWNLOAD_(HOST_BLOCKED|NOT_JPEG)/);
 await assert.rejects(boundedJpeg(new Response(jpeg,{headers:{'content-length':String(maxTestBytes+1)}})),/FILE_TOO_LARGE/);
 await assert.rejects(boundedJpeg(new Response(new Uint8Array(maxTestBytes+1))),/FILE_TOO_LARGE/);
 await assert.rejects(fetchTestJpeg('token',{driveId:'drive',itemId:'item',fileName:'NVH-001.jpg',size:jpeg.length},async()=>new Response(null,{status:302,headers:{location:'https://evil.example/test'}})),/DOWNLOAD_(HOST_BLOCKED|NOT_JPEG)/);
});
test('test downloads need explicit admin and a right, repeat without extra orders, history stays company scoped',async()=>{
 const db=new PGlite({extensions:{btree_gist}});try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to authenticated;`);
 const load=async f=>db.exec(await readFile(new URL('../database/'+f,import.meta.url),'utf8'));
 await load('migrations/001_accounts.sql');const admin='ab74ba00-4f8e-4ee0-8479-bee145211f16',normal='11111111-1111-1111-1111-111111111111';
 for(const id of [admin,normal])await db.query('insert into auth.users values($1,$2,now())',[id,{first_name:'Test',last_name:'User',requested_company_name:'Edwin',requested_kvk:'77328949'}]);
 const company=(await db.query("insert into public.companies(name,kvk_number) values('Edwin','77328949') returning id")).rows[0].id;await db.query("update public.profiles set status='approved',company_id=$1,reviewed_at=now()",[company]);
 for(const f of ['002_prices','003_test_orders','004_onedrive_connection','005_test_downloads'])await load('migrations/'+f+'.sql');await load('set-edwin-prices.sql');
 const purpose=(await db.query("select id from public.usage_purposes where name='Online'")).rows[0].id;
 const auth=async id=>db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
 await auth(admin);await assert.rejects(db.query('select public.test_download_right($1)',[purpose]),/TEST_RIGHT_REQUIRED/);
 const quote=(await db.query("select public.test_order_quote('NVH-0001',$1) q",[purpose])).rows[0].q;
 await db.query("select public.place_test_order('NVH-0001',$1,$2,$3,$4,true)",[purpose,quote.agreement_id,quote.amount_cents,quote.agreement_text]);
 assert.ok((await db.query('select public.test_download_right($1) r',[purpose])).rows[0].r.order_item_id);
 await db.query('select public.record_test_download($1,$2)',[purpose,jpeg.length]);await db.query('select public.record_test_download($1,$2)',[purpose,jpeg.length]);
 assert.equal((await db.query('select count(*)::int n from public.download_events')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n,1);
 await assert.rejects(db.query('select public.record_test_download($1,$2)',[purpose,maxTestBytes+1]),/check constraint/);
 await auth(normal);await assert.rejects(db.query('select public.test_download_right($1)',[purpose]),/ADMIN_REQUIRED/);await assert.rejects(db.query('select public.record_test_download($1,10)',[purpose]),/ADMIN_REQUIRED/);assert.equal((await db.query('select * from public.download_events')).rows.length,2);
 await assert.rejects(db.exec("insert into public.download_events(user_id,order_item_id,file_name,byte_count) select user_id,order_item_id,file_name,byte_count from public.download_events limit 1"),/permission denied/);
 await db.exec('reset role');const other=(await db.query("insert into public.companies(name,kvk_number) values('Other','12345678') returning id")).rows[0].id;await db.query('update public.profiles set company_id=$1 where id=$2',[other,normal]);await auth(normal);assert.equal((await db.query('select * from public.download_events')).rows.length,0);
 await db.exec('reset role');await db.query("update public.profiles set status='suspended' where id=$1",[admin]);await auth(admin);await assert.rejects(db.query('select public.test_download_right($1)',[purpose]),/ADMIN_REQUIRED/);assert.equal((await db.query('select * from public.download_events')).rows.length,0);
 }finally{await db.close()}
});
