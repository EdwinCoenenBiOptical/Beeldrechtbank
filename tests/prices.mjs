import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
const sql=async file=>readFile(new URL('../database/'+file,import.meta.url),'utf8');

test('company tariffs, intervals, and approval-dependent access',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to authenticated;`);
  await db.exec(await sql('migrations/001_accounts.sql'));
  await db.exec(await sql('migrations/002_prices.sql'));
  // Missing company must be an explicit failure, with no tariffs added.
  await assert.rejects(db.exec(await sql('set-edwin-prices.sql')),/Company with KvK/);await db.exec('rollback');
  const company=(await db.query("insert into public.companies(name,kvk_number) values('Edwin Coenen','77328949') returning id")).rows[0].id;
  const otherCompany=(await db.query("insert into public.companies(name,kvk_number) values('Other','12345678') returning id")).rows[0].id;
  await db.exec(await sql('set-edwin-prices.sql'));await db.exec(await sql('set-edwin-prices.sql'));
  const tariffs=(await db.query('select u.name,p.amount_cents from public.company_prices p join public.usage_purposes u on u.id=p.purpose_id order by u.sort_order')).rows;
  assert.deepEqual(tariffs,[{name:'Online',amount_cents:10000},{name:'Print',amount_cents:17500},{name:'TV',amount_cents:25000}]);
  const online=(await db.query("select id from public.usage_purposes where name='Online'")).rows[0].id;
  await assert.rejects(db.query('insert into public.company_prices(company_id,purpose_id,amount_cents,valid_from) values($1,$2,1,current_date+1)',[company,online]),/exclusion constraint/);
  await assert.rejects(db.query('insert into public.company_prices(company_id,purpose_id,amount_cents) values($1,$2,-1)',[otherCompany,online]),/check constraint/);
  await db.query('insert into public.company_prices(company_id,purpose_id,amount_cents) values($1,$2,12345)',[otherCompany,online]);
  const user='11111111-1111-1111-1111-111111111111';
  await db.query('insert into auth.users values($1,$2,now())',[user,{first_name:'Edwin',last_name:'Coenen',requested_company_name:'Edwin Coenen',requested_kvk:'77328949'}]);
  async function asUser(){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`);}
  await asUser();assert.equal((await db.query('select * from public.company_prices')).rows.length,0);assert.equal((await db.query('select * from public.usage_purposes')).rows.length,0);await db.exec('reset role');
  await db.query("update public.profiles set status='approved',company_id=$1,reviewed_at=now() where id=$2",[company,user]);
  await asUser();assert.equal((await db.query('select * from public.company_prices')).rows.length,3);assert.equal((await db.query('select * from public.usage_purposes')).rows.length,3);
  assert.equal((await db.query('select * from public.company_prices where company_id=$1',[otherCompany])).rows.length,0);
  await assert.rejects(db.exec('update public.company_prices set amount_cents=0'),/permission denied/);await assert.rejects(db.exec("update public.usage_purposes set active=false"),/permission denied/);
  await db.exec('reset role');await db.exec("update public.usage_purposes set active=false where name='TV'");
  await asUser();assert.equal((await db.query('select * from public.company_prices')).rows.length,2);await db.exec('reset role');
  await db.query('update public.company_prices set valid_until=current_date+1 where company_id=$1 and purpose_id=$2',[company,online]);
  await db.query('insert into public.company_prices(company_id,purpose_id,amount_cents,valid_from) values($1,$2,99999,current_date+1)',[company,online]);
  await asUser();assert.equal((await db.query('select amount_cents from public.company_prices where purpose_id=$1',[online])).rows[0].amount_cents,10000);await db.exec('reset role');
  await db.query("update public.profiles set status='suspended' where id=$1",[user]);await asUser();assert.equal((await db.query('select * from public.company_prices')).rows.length,0);
  await db.exec('reset role;set role anon');await assert.rejects(db.exec('select * from public.company_prices'),/permission denied/);
 }finally{await db.close()}
});
