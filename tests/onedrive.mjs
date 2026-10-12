import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {seal,open,newOAuthState,challenge,validState} from '../lib/onedrive/security.mjs';
test('OneDrive encryption, PKCE and callback state binding',()=>{
 const secret='fictional-client-secret-for-tests-only',tokens={accessToken:'fictional-access',refreshToken:'fictional-refresh'};
 const encrypted=seal(tokens,secret,'tokens');assert.ok(!encrypted.includes('fictional-access'));assert.deepEqual(open(encrypted,secret,'tokens'),tokens);
 assert.notEqual(encrypted,seal(tokens,secret,'tokens'));
 assert.throws(()=>open(encrypted,'different-secret','tokens'));assert.throws(()=>open(encrypted,secret,'oauth'));
 const parts=encrypted.split('.');const bytes=Buffer.from(parts[3],'base64url');bytes[0]^=1;parts[3]=bytes.toString('base64url');assert.throws(()=>open(parts.join('.'),secret,'tokens'));
 const state=newOAuthState('admin',1000);assert.ok(validState(state,state.state,'admin',1001));assert.ok(!validState(state,state.state,'other-user',1001));assert.ok(!validState(state,'wrong','admin',1001));assert.ok(!validState(state,state.state,'admin',601001));assert.ok(!validState(state,state.state,'admin',999));
 assert.ok(state.verifier.length>=43&&state.verifier.length<=128);assert.match(challenge(state.verifier),/^[a-zA-Z0-9_-]{43}$/);
});
test('only explicitly designated, approved administrators can manage encrypted connection',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to authenticated;`);
 await db.exec(await readFile(new URL('../database/migrations/001_accounts.sql',import.meta.url),'utf8'));
 const admin='ab74ba00-4f8e-4ee0-8479-bee145211f16',normal='11111111-1111-1111-1111-111111111111';
 for(const id of [admin,normal])await db.query('insert into auth.users values($1,$2,now())',[id,{first_name:'Test',last_name:'Account',requested_company_name:'Test',requested_kvk:'77328949',is_onedrive_admin:true}]);
 const company=(await db.query("insert into public.companies(name,kvk_number) values('Test','77328949') returning id")).rows[0].id;
 await db.query("update public.profiles set status='approved',company_id=$1,reviewed_at=now()",[company]);
 await db.exec(await readFile(new URL('../database/migrations/004_onedrive_connection.sql',import.meta.url),'utf8'));
 const asUser=async id=>db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
 await asUser(normal);assert.equal((await db.query('select public.is_onedrive_admin() a')).rows[0].a,false);
 await assert.rejects(db.exec('select public.read_onedrive_connection()'),/ADMIN_REQUIRED/);await assert.rejects(db.exec("select public.save_onedrive_connection('cipher','{}',0)"),/ADMIN_REQUIRED/);await assert.rejects(db.exec('select * from private.onedrive_connection'),/permission denied/);await assert.rejects(db.exec(`insert into private.onedrive_admins values('${normal}')`),/permission denied/);
 await asUser(admin);assert.equal((await db.query('select public.is_onedrive_admin() a')).rows[0].a,true);assert.equal((await db.query('select public.read_onedrive_connection() c')).rows[0].c,null);
 assert.equal((await db.query("select public.save_onedrive_connection('encrypted-test','{\"fileName\":\"NVH-001.jpg\"}',0) r")).rows[0].r,1);
 assert.equal((await db.query('select public.read_onedrive_connection() c')).rows[0].c.encrypted_tokens,'encrypted-test');
 assert.equal((await db.query("select public.save_onedrive_connection('new-encrypted','{}',1) r")).rows[0].r,2);
 await assert.rejects(db.exec("select public.save_onedrive_connection('old','{}',1)"),/CONNECTION_CHANGED/);
 await db.exec('reset role');await db.query("update public.profiles set status='suspended' where id=$1",[admin]);await asUser(admin);assert.equal((await db.query('select public.is_onedrive_admin() a')).rows[0].a,false);await assert.rejects(db.exec('select public.read_onedrive_connection()'),/ADMIN_REQUIRED/);
 await db.exec('reset role;set role anon');await assert.rejects(db.exec('select public.is_onedrive_admin()'),/permission denied/);
 }finally{await db.close()}
});
