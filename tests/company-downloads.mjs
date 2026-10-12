import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {trustedDownloadUrl,fetchTestJpeg,boundedJpeg,maxTestBytes} from '../lib/onedrive/download.mjs';
const jpeg=new Uint8Array([255,216,255,224,0,0,255,217]);
test('company staff download with existing rights; server-only credentials and event writes, no duplicate orders',async()=>{
 const db=new PGlite({extensions:{btree_gist}});try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;`);
 const load=async f=>db.exec(await readFile(new URL('../database/'+f,import.meta.url),'utf8'));
 await load('migrations/001_accounts.sql');const admin='ab74ba00-4f8e-4ee0-8479-bee145211f16',normal='11111111-1111-1111-1111-111111111111';
 for(const id of [admin,normal])await db.query('insert into auth.users values($1,$2,now())',[id,{first_name:'Test',last_name:'User',requested_company_name:'Edwin',requested_kvk:'77328949'}]);
 const company=(await db.query("insert into public.companies(name,kvk_number) values('Edwin','77328949') returning id")).rows[0].id;await db.query("update public.profiles set status='approved',company_id=$1,reviewed_at=now()",[company]);
 for(const f of ['002_prices','003_test_orders','004_onedrive_connection','005_test_downloads','009_company_downloads'])await load('migrations/'+f+'.sql');await load('set-edwin-prices.sql');
 const purpose=(await db.query("select id from public.usage_purposes where name='Online'")).rows[0].id;
 const auth=async id=>db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
 await db.query("insert into private.onedrive_connection(encrypted_tokens,metadata) values('encrypted-test-token','{}')");
 await db.exec('set role service_role');assert.equal((await db.query('select public.server_read_onedrive_connection() r')).rows[0].r.encrypted_tokens,'encrypted-test-token');
 assert.equal((await db.query("select public.server_save_onedrive_connection('new-encrypted-token','{}',1) r")).rows[0].r,2);
 await assert.rejects(db.query("select public.server_save_onedrive_connection('stale','{}',1)"),/CONNECTION_CHANGED/);
 await auth(admin);await assert.rejects(db.query('select public.test_download_right($1)',[purpose]),/TEST_RIGHT_REQUIRED/);
 const quote=(await db.query("select public.test_order_quote('NVH-0001',$1) q",[purpose])).rows[0].q;
 await db.query("select public.place_test_order('NVH-0001',$1,$2,$3,$4,true)",[purpose,quote.agreement_id,quote.amount_cents,quote.agreement_text]);
 assert.ok((await db.query('select public.test_download_right($1) r',[purpose])).rows[0].r.order_item_id);
 const right=(await db.query('select public.test_download_right($1) r',[purpose])).rows[0].r;
 await db.exec('reset role;set role service_role');
 await db.query('select public.server_record_test_download($1,$2,$3,$4)',[admin,purpose,right.order_item_id,jpeg.length]);await db.query('select public.server_record_test_download($1,$2,$3,$4)',[normal,purpose,right.order_item_id,jpeg.length]);
 await auth(admin);
 assert.equal((await db.query('select count(*)::int n from public.download_events')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n,1);
 await db.exec('reset role;set role service_role');await assert.rejects(db.query('select public.server_record_test_download($1,$2,$3,$4)',[normal,purpose,right.order_item_id,maxTestBytes+1]),/check constraint/);
 await assert.rejects(db.query('select public.server_record_test_download($1,$2,$3,$4)',[normal,purpose,'99999999-9999-9999-9999-999999999999',10]),/TEST_RIGHT_CHANGED/);
 await auth(normal);assert.ok((await db.query('select public.test_download_right($1) r',[purpose])).rows[0].r.order_item_id);await assert.rejects(db.query('select public.record_test_download($1,10)',[purpose]),/permission denied/);await assert.rejects(db.query('select public.server_read_onedrive_connection()'),/permission denied/);await assert.rejects(db.query('select public.server_record_test_download($1,$2,$3,10)',[normal,purpose,right.order_item_id]),/permission denied/);assert.equal((await db.query('select * from public.download_events')).rows.length,2);
 await assert.rejects(db.exec("insert into public.download_events(user_id,order_item_id,file_name,byte_count) select user_id,order_item_id,file_name,byte_count from public.download_events limit 1"),/permission denied/);
 await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=null where id=$1',[normal]);await auth(normal);await assert.rejects(db.query('select public.test_download_right($1)',[purpose]),/TEST_RIGHT_REQUIRED/);await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[normal]);
 const other=(await db.query("insert into public.companies(name,kvk_number) values('Other','12345678') returning id")).rows[0].id;await db.query('update public.profiles set company_id=$1 where id=$2',[other,normal]);await auth(normal);await assert.rejects(db.query('select public.test_download_right($1)',[purpose]),/TEST_RIGHT_REQUIRED/);assert.equal((await db.query('select * from public.download_events')).rows.length,0);
 await db.exec('reset role;set role service_role');await assert.rejects(db.query('select public.server_record_test_download($1,$2,$3,10)',[normal,purpose,right.order_item_id]),/TEST_RIGHT_REQUIRED/);
 await db.exec('reset role');await db.query("update public.profiles set status='suspended' where id=$1",[admin]);await auth(admin);await assert.rejects(db.query('select public.test_download_right($1)',[purpose]),/TEST_RIGHT_REQUIRED/);assert.equal((await db.query('select * from public.download_events')).rows.length,0);
 }finally{await db.close()}
});
