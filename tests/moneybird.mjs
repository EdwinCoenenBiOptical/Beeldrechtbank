import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createMoneybirdReader,invoiceRecipient,contactSummary,moneybirdId} from '../lib/moneybird/contacts.mjs';
const contactId='12345678901234567890',administrationId='98765432109876543210';
const raw={id:contactId,company_name:'Bi-Optical',chamber_of_commerce:'77328949',email:'general@example.com',send_invoices_to_email:'finance@example.com',send_invoices_to_attention:'Finance',address1:'Street 1',zipcode:'1234 AB',city:'Utrecht',country:'NL',contact_people:[{id:'123',firstname:'Edwin',lastname:'Coenen',email:'edwin@example.com'},{id:'456',firstname:'Finance',lastname:'Team',email:''}],bank_account:'not needed',notes:[{note:'not needed'}]};
test('Moneybird reader only GETs fixed hosts, preserves IDs, projects contacts and validates contact people',async()=>{
 const calls=[];const reader=createMoneybirdReader({token:'private-test-token',administrationId},async(url,options)=>{calls.push({url,options});return Response.json(url.pathname.endsWith('/contacts.json')?[raw]:raw)});
 const results=await reader.search('Bi & Optical',2);assert.equal(results.page,2);assert.equal(results.contacts[0].id,contactId);assert.equal(results.has_more,false);
 assert.equal(calls[0].url.origin,'https://moneybird.com');assert.equal(calls[0].url.pathname,`/api/v2/${administrationId}/contacts.json`);assert.equal(calls[0].url.searchParams.get('query'),'Bi & Optical');assert.equal(calls[0].url.searchParams.get('per_page'),'25');assert.equal(calls[0].url.searchParams.get('page'),'2');
 const contact=await reader.contact(contactId);assert.equal(contact.id,contactId);assert.equal(contact.bank_account,undefined);assert.equal(contact.notes,undefined);
 assert.deepEqual(invoiceRecipient(contact,null),{id:null,name:'Finance',email:'finance@example.com'});assert.equal(invoiceRecipient(contact,'123').email,'edwin@example.com');assert.equal(invoiceRecipient(contact,'456').email,'finance@example.com');assert.throws(()=>invoiceRecipient(contact,'789'),/MONEYBIRD_PERSON_MISSING/);
 for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers.Authorization,'Bearer private-test-token');assert.equal(call.options.body,undefined);assert.equal(call.url.toString().includes('private-test-token'),false)}
 await assert.rejects(reader.contact('../sales_invoices'),/MONEYBIRD_QUERY/);await assert.rejects(reader.search('x'),/MONEYBIRD_QUERY/);assert.equal(moneybirdId(Number(contactId)),false);assert.throws(()=>createMoneybirdReader({token:'',administrationId}),/MONEYBIRD_CONFIG/);assert.throws(()=>contactSummary({id:Number(contactId)}),/MONEYBIRD_RESPONSE/);
 const full=createMoneybirdReader({token:'token',administrationId},async()=>Response.json(Array.from({length:25},()=>raw)));assert.equal((await full.search('77328949')).has_more,true);
 for(const [status,code] of [[401,'MONEYBIRD_ACCESS'],[403,'MONEYBIRD_ACCESS'],[404,'MONEYBIRD_CONTACT_MISSING'],[429,'MONEYBIRD_RATE_LIMIT'],[500,'MONEYBIRD_UNAVAILABLE']]){const bad=createMoneybirdReader({token:'private-test-token',administrationId},async()=>new Response('Sensitive provider response',{status}));await assert.rejects(bad.contact(contactId),e=>e.message===code)}
 const wrong=createMoneybirdReader({token:'token',administrationId},async()=>Response.json({...raw,id:'999'}));await assert.rejects(wrong.contact(contactId),/MONEYBIRD_RESPONSE/);
});
test('company Moneybird mapping requires admin, server-verified writes, unique contacts, reason and current revision; history retained',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;`);
 const load=async name=>db.exec(await readFile(new URL('../database/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await load('001_accounts');const admin='ab74ba00-4f8e-4ee0-8479-bee145211f16',person='11111111-1111-1111-1111-111111111111';
 for(const id of [admin,person])await db.query('insert into auth.users values($1,$2,$3,now())',[id,id+'@example.com',{first_name:'Test',last_name:'Person',requested_company_name:'Bi-Optical',requested_kvk:'77328949',is_admin:true}]);
 const a=(await db.query("insert into public.companies(name,kvk_number) values('Bi-Optical','77328949') returning id")).rows[0].id;
 const b=(await db.query("insert into public.companies(name,kvk_number) values('Other','12345678') returning id")).rows[0].id;
 await db.query("update public.profiles set status='approved',company_id=$1,reviewed_at=now()",[a]);
 for(const name of ['004_onedrive_connection','007_application_admin','010_moneybird_contacts'])await load(name);
 const auth=async id=>db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
 const contact=contactSummary(raw),recipient=invoiceRecipient(contact,'123');
 const link=async(actor,company,c,revision,reason=null)=>(await db.query('select public.server_link_moneybird_company($1,$2,$3,$4,$5,$6,$7,$8) r',[actor,company,administrationId,c.id,c,recipient,revision,reason])).rows[0].r;
 await auth(person);await assert.rejects(db.query('select public.admin_moneybird_company($1)',[a]),/ADMIN_REQUIRED/);await assert.rejects(link(person,a,contact,0),/permission denied/);await assert.rejects(db.exec('select * from private.moneybird_company_links'),/permission denied/);
 await auth(admin);assert.equal((await db.query('select public.admin_moneybird_company($1) r',[a])).rows[0].r.link,null);await assert.rejects(link(admin,a,contact,0),/permission denied/);
 await db.exec('reset role;set role service_role');await assert.rejects(link(person,a,contact,0),/ADMIN_REQUIRED/);
 let result=await link(admin,a,contact,0);assert.equal(result.contact_id,contactId);assert.equal(result.revision,1);assert.equal(result.recipient_snapshot.id,'123');
 await assert.rejects(link(admin,a,contact,0),/LINK_CHANGED/);
 await assert.rejects(link(admin,b,contact,0),/LINK_REASON_REQUIRED/);await assert.rejects(link(admin,b,contact,0,'Verified parent company'),/CONTACT_ALREADY_LINKED/);
 await assert.rejects(link(admin,a,{...contact,id:'777'},1),/LINK_REASON_REQUIRED/);
 await assert.rejects(link(admin,a,{...contact,kvk:''},1),/LINK_REASON_REQUIRED/);
 result=await link(admin,a,{...contact,id:'777'},1,'Accounting contact replaced');assert.equal(result.revision,2);
 result=await link(admin,a,{...contact,id:'777',name:'Updated company name'},2);assert.equal(result.contact_snapshot.name,'Updated company name');assert.equal(result.revision,3);
 await auth(admin);let state=(await db.query('select public.admin_moneybird_company($1) r',[a])).rows[0].r;assert.equal(state.link.contact_id,'777');assert.equal(state.company.name,'Bi-Optical');
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from private.moneybird_link_history')).rows[0].n,3);const history=(await db.query("select * from private.moneybird_link_history where reason='Accounting contact replaced'")).rows[0];assert.equal(history.previous_link.contact_id,contactId);assert.equal(history.new_link.contact_id,'777');assert.equal(history.actor_id,admin);
 await db.query('update public.profiles set company_id=$1 where id=$2',[b,person]);assert.equal((await db.query('select contact_id from private.moneybird_company_links where company_id=$1',[a])).rows[0].contact_id,'777');
 await db.query("update public.profiles set status='suspended' where id=$1",[admin]);await db.exec('set role service_role');await assert.rejects(link(admin,a,contact,3,'changed'),/ADMIN_REQUIRED/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select public.admin_moneybird_company($1)',[a]),/permission denied/);
 }finally{await db.close()}
});
