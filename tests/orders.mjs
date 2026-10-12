import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
const sql=async f=>readFile(new URL('../database/'+f,import.meta.url),'utf8');
test('test orders require consent and preserve snapshots and reusable company rights',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const f of ['001_accounts','002_prices','003_test_orders'])await db.exec(await sql('migrations/'+f+'.sql'));
 const c=(await db.query("insert into public.companies(name,kvk_number) values('Edwin Coenen','77328949') returning id")).rows[0].id;
 await db.exec(await sql('set-edwin-prices.sql'));
 const u='11111111-1111-1111-1111-111111111111',colleague='22222222-2222-2222-2222-222222222222';
 for(const id of [u,colleague])await db.query('insert into auth.users values($1,$2,now())',[id,{first_name:'Test',last_name:'Persoon',requested_company_name:'Edwin Coenen',requested_kvk:'77328949'}]);
 const p=(await db.query("select id from public.usage_purposes where name='Print'")).rows[0].id;
 const queryQuote=()=>db.query("select public.test_order_quote('NVH-0001',$1) as q",[p]);
 const place=(q,accept=true)=>db.query("select public.place_test_order('NVH-0001',$1,$2,$3,$4,$5) as q",[p,q.agreement_id,q.amount_cents,q.agreement_text,accept]);
 const auth=async id=>db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
 await auth(u);await assert.rejects(queryQuote(),/APPROVAL_REQUIRED/);await db.exec('reset role');
 await db.query("update public.profiles set status='approved',company_id=$1,reviewed_at=now()",[c]);
 await auth(u);let q=(await queryQuote()).rows[0].q;
 assert.equal(q.amount_cents,17500);assert.equal(q.vat_cents,3675);assert.equal(q.total_cents,21175);assert.equal(q.is_test,true);assert.ok(q.agreement_text.includes('175,00'));
 await assert.rejects(place(q,false),/CONSENT_REQUIRED/);await assert.rejects(place({...q,amount_cents:1}),/QUOTE_CHANGED/);await assert.rejects(place({...q,agreement_text:'Different text'}),/QUOTE_CHANGED/);
 const order=(await place(q)).rows[0].q;assert.equal(order.owned,true);assert.ok(order.order_number);assert.equal((await place(q)).rows[0].q.order_id,order.order_id);
 assert.equal((await db.query('select count(*)::int n from public.orders')).rows[0].n,1);
 await assert.rejects(db.exec('update public.order_items set amount_cents=0'),/permission denied/);
 await auth(colleague);assert.equal((await place(q)).rows[0].q.order_id,order.order_id);assert.equal((await db.query('select * from public.usage_rights')).rows.length,1);
 await db.exec('reset role');await db.exec("update public.company_prices set amount_cents=99999");await db.exec("update public.usage_purposes set name='Print gewijzigd' where name='Print'");
 await auth(u);q=(await queryQuote()).rows[0].q;assert.equal(q.amount_cents,17500);assert.equal(q.purpose_name,'Print');assert.equal(q.agreement_text,order.agreement_text);
 await db.exec('reset role');await db.query('update public.company_prices set amount_cents=101 where purpose_id=$1',[p]);
 await auth(u);const small=(await db.query("select public.test_order_quote('NVH-0002',$1) q",[p])).rows[0].q;assert.equal(small.vat_cents,21);assert.equal(small.total_cents,122);
 await db.exec('reset role');await db.query('update public.company_prices set amount_cents=102 where purpose_id=$1',[p]);
 await auth(u);await assert.rejects(db.query("select public.place_test_order('NVH-0002',$1,$2,$3,$4,true)",[p,small.agreement_id,small.amount_cents,small.agreement_text]),/QUOTE_CHANGED/);
 await db.exec('reset role');await db.query("update public.profiles set status='suspended' where id=$1",[u]);await auth(u);await assert.rejects(queryQuote(),/APPROVAL_REQUIRED/);assert.equal((await db.query('select * from public.orders')).rows.length,0);
 await db.exec('reset role;set role anon');await assert.rejects(queryQuote(),/permission denied/);
 }finally{await db.close()}
});
