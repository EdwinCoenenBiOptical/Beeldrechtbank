import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {confirmationToken} from '../lib/auth/confirmation.mjs';
test('email confirmation fragment parsing does not accept arbitrary input',()=>{assert.equal(confirmationToken('#token_hash='+'a'.repeat(64)),'a'.repeat(64));assert.equal(confirmationToken('#token_hash=bad'),null);assert.equal(confirmationToken(''),null)});
test('admin review requires an explicit administrator, confirmed email and matching company',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to authenticated;`);
 const load=async f=>db.exec(await readFile(new URL('../database/migrations/'+f+'.sql',import.meta.url),'utf8'));
 await load('001_accounts');const admin='ab74ba00-4f8e-4ee0-8479-bee145211f16',normal='11111111-1111-1111-1111-111111111111',newPerson='22222222-2222-2222-2222-222222222222',rejectPerson='33333333-3333-3333-3333-333333333333';
 for(const id of [admin,normal,newPerson,rejectPerson])await db.query('insert into auth.users values($1,$2,$3,null)',[id,id+'@example.com',{first_name:'Test',last_name:'User',requested_company_name:'Bi-Optical',requested_kvk:id===newPerson?'12345678':'77328949',is_admin:true}]);
 const c=(await db.query("insert into public.companies(name,kvk_number) values('Edwin Coenen','77328949') returning id")).rows[0].id;
 await db.query("update public.profiles set status='approved',company_id=$1,reviewed_at=now() where id=$2",[c,admin]);await db.query('update auth.users set email_confirmed_at=now() where id=$1',[admin]);
 await load('004_onedrive_connection');await load('007_application_admin');
 const auth=async id=>db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
 await auth(normal);await assert.rejects(db.exec('select public.admin_application_overview(1,\'pending\')'),/ADMIN_REQUIRED/);await assert.rejects(db.query("select public.admin_review_application($1,'approved',$2,null)",[normal,c]),/ADMIN_REQUIRED/);
 await auth(admin);let result=(await db.query("select public.admin_application_overview(1,'pending') r")).rows[0].r;assert.equal(result.total,3);assert.equal(result.applications.find(a=>a.id===normal).matching_company_id,c);
 await assert.rejects(db.query("select public.admin_review_application($1,'approved',$2,null)",[normal,c]),/EMAIL_CONFIRMATION_REQUIRED/);await assert.rejects(db.query("select public.admin_review_application($1,'rejected',null,null)",[admin]),/SELF_REVIEW_FORBIDDEN/);
 await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id in ($1,$2)',[normal,newPerson]);await auth(admin);
 await assert.rejects(db.query("select public.admin_review_application($1,'approved',$2,null)",[newPerson,c]),/COMPANY_MISMATCH/);
 const approved=(await db.query("select public.admin_review_application($1,'approved',$2,$3) r",[normal,c,'Do not rename the existing company'])).rows[0].r;assert.equal(approved.company_name,'Edwin Coenen');assert.equal(approved.status,'approved');
 await assert.rejects(db.query("select public.admin_review_application($1,'rejected',null,null)",[normal]),/APPLICATION_ALREADY_REVIEWED/);
 await db.query("select public.admin_review_application($1,'approved',null,$2)",[newPerson,'Nieuwe redactie']);await db.query("select public.admin_review_application($1,'rejected',null,null)",[rejectPerson]);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from public.companies')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from private.application_reviews')).rows[0].n,3);assert.equal((await db.query('select status from public.profiles where id=$1',[rejectPerson])).rows[0].status,'rejected');
 await db.query("update public.profiles set status='suspended' where id=$1",[admin]);await auth(admin);await assert.rejects(db.exec("select public.admin_application_overview(1,'pending')"),/ADMIN_REQUIRED/);
 }finally{await db.close()}
});
