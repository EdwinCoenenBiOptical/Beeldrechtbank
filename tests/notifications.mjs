import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {registrationMail,deliverRegistration,validJobSecret,registrationRecipient} from '../lib/notifications/registration.mjs';
test('registration mail has fixed recipient, no password and provider idempotency',async()=>{
 const record={id:'test-id',full_name:'Edwin\nUnexpected field',email:'test@example.com',company_name:'Test',kvk_number:'77328949',password:'never include this'};
 const mail=registrationMail(record,'Beeldrechtbank <aanmeldingen@example.com>');assert.deepEqual(mail.to,[registrationRecipient]);assert.ok(mail.text.includes('Edwin Unexpected field'));assert.ok(!JSON.stringify(mail).includes(record.password));
 let calls=0;const sent=await deliverRegistration(record,{from:mail.from,apiKey:'fictional-key'},async(url,options)=>{calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'registration-test-id');assert.equal(JSON.parse(options.body).to[0],registrationRecipient);return Response.json({id:'provider-id'})});assert.equal(sent,'provider-id');assert.equal(calls,1);
 await assert.rejects(deliverRegistration(record,{from:mail.from,apiKey:'fake'},async()=>new Response(null,{status:429})),/MAIL_PROVIDER_REJECTED/);
 const secret='fictional-job-secret-over-thirty-two-characters';assert.ok(validJobSecret(secret,secret));assert.ok(!validJobSecret('wrong',secret));assert.ok(!validJobSecret(null,secret));assert.ok(!validJobSecret('short','short'));
});
test('signup queues once, workers claim exclusively, failures retry and customers cannot access notifications',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public to service_role;grant usage on schema public,auth to anon,authenticated;`);
 for(const file of ['001_accounts','006_registration_notifications'])await db.exec(await readFile(new URL('../database/migrations/'+file+'.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1,$2,$3,null)',['11111111-1111-1111-1111-111111111111','test@example.com',{first_name:'Test',last_name:'Person',requested_company_name:'Testbedrijf',requested_kvk:'77328949'}]);
 assert.equal((await db.query('select count(*)::int n from public.registration_notifications')).rows[0].n,1);
 await db.exec('set role authenticated');await assert.rejects(db.exec('select * from public.registration_notifications'),/permission denied/);await assert.rejects(db.exec('select public.claim_registration_notifications(10)'),/permission denied/);
 await db.exec('reset role;set role service_role');const claimed=(await db.query('select * from public.claim_registration_notifications(3)')).rows;assert.equal(claimed.length,1);assert.equal(claimed[0].email,'test@example.com');assert.equal((await db.query('select * from public.claim_registration_notifications(3)')).rows.length,0);
 assert.equal((await db.query('select public.finish_registration_notification($1,$2,null,$3) done',[claimed[0].id,claimed[0].lock_token,'FAILED'])).rows[0].done,true);
 assert.equal((await db.query('select * from public.claim_registration_notifications(3)')).rows.length,0);
 await db.exec("reset role;update public.registration_notifications set next_attempt_at=now()-interval '1 second';set role service_role");const retry=(await db.query('select * from public.claim_registration_notifications(3)')).rows[0];assert.equal(retry.attempts,2);
 assert.equal((await db.query('select public.finish_registration_notification($1,$2,$3,null) done',[retry.id,claimed[0].lock_token,'old-worker'])).rows[0].done,false);
 assert.equal((await db.query('select public.finish_registration_notification($1,$2,$3,null) done',[retry.id,retry.lock_token,'provider-id'])).rows[0].done,true);assert.equal((await db.query('select * from public.claim_registration_notifications(3)')).rows.length,0);
 await db.exec('reset role');const final=(await db.query('select * from public.registration_notifications')).rows[0];assert.equal(final.status,'sent');assert.equal(final.provider_id,'provider-id');assert.ok(final.sent_at);
 }finally{await db.close()}
});

test('SMTP registration worker uses fixed recipient and records acceptance or a retry without changing accounts',async()=>{
 const {dispatchRegistrations}=await import('../lib/notifications/worker.mjs');
 const env={REGISTRATION_NOTIFICATIONS_ENABLED:'true',SMTP_HOST:'rootnet.email',SMTP_PORT:'587',SMTP_USER:'info@beeldrechtbank.nl',SMTP_PASSWORD:'fictional'};
 const record={id:'11111111-1111-1111-1111-111111111111',lock_token:'lock',full_name:'Nicole',email:'person@example.test',company_name:'Testbedrijf',kvk_number:'12345678'};
 for(const fail of [false,true]){
  const calls=[];let closed=false;
  const client={rpc:async(name,args)=>{calls.push([name,args]);return name==='claim_smtp_registration_notifications'?{data:[record]}:{data:true}}};
  const transport={sendMail:async(mail)=>{assert.deepEqual(mail.to,['info@rechtbanktekeningen.nl']);assert.equal(mail.from.address,'info@beeldrechtbank.nl');assert.ok(mail.text.includes('https://www.beeldrechtbank.nl/#beheer'));assert.ok(!mail.text.includes('supabase.com'));if(fail)throw Error('offline');return {accepted:mail.to,messageId:'accepted-id'}},close:()=>{closed=true}};
  assert.deepEqual(await dispatchRegistrations({env,client,transport}),fail?{sent:0,retry:1}:{sent:1,retry:0});assert.ok(closed);
  assert.equal(calls.length,2);assert.equal(calls[1][1].p_provider_id,fail?null:'accepted-id');assert.equal(calls[1][1].p_error_code,fail?'REGISTRATION_SMTP_FAILED':null);
 }
 assert.deepEqual(await dispatchRegistrations({env:{}}),{disabled:true,sent:0,retry:0});
});

test('SMTP migration supports fresh installs and existing parked queues, without sending historical signups',async()=>{
 for(const existing of [false,true]){
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public to service_role;grant usage on schema public,auth to anon,authenticated;`);
 await db.exec(await readFile(new URL('../database/migrations/001_accounts.sql',import.meta.url),'utf8'));
 if(existing)await db.exec(await readFile(new URL('../database/migrations/006_registration_notifications.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1,$2,$3,null)',['11111111-1111-1111-1111-111111111111','old@example.test',{first_name:'Old',last_name:'User',requested_company_name:'Old',requested_kvk:'12345678'}]);
 await db.exec(await readFile(new URL('../database/migrations/021_registration_smtp.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1,$2,$3,null)',['22222222-2222-2222-2222-222222222222','new@example.test',{first_name:'New',last_name:'User',requested_company_name:'New',requested_kvk:'87654321'}]);
 await db.exec('set role service_role');const rows=(await db.query('select * from public.claim_smtp_registration_notifications(3)')).rows;assert.equal(rows.length,1);assert.equal(rows[0].email,'new@example.test');
 }finally{await db.close()}
 }
});
