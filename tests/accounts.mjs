import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('registration, approval and access rules in PostgreSQL', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key, raw_user_meta_data jsonb, email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth,public to anon,authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(await readFile(new URL('../database/migrations/001_accounts.sql',import.meta.url),'utf8'));
  const user='11111111-1111-1111-1111-111111111111', other='22222222-2222-2222-2222-222222222222';
  const metadata={first_name:'Edwin',name_prefix:'',last_name:'Coenen',requested_company_name:'Edwin Coenen',requested_kvk:'77328949',status:'approved',company_id:'33333333-3333-3333-3333-333333333333'};
  await db.query('insert into auth.users values($1,$2,null)',[user,metadata]);
  let row=(await db.query('select * from public.profiles where id=$1',[user])).rows[0];
  assert.equal(row.status,'pending');assert.equal(row.company_id,null);assert.equal(row.full_name,'Edwin Coenen');
  await db.query('insert into auth.users values($1,$2,now())',[other,{...metadata,first_name:'Andere'}]);
  await assert.rejects(db.query('insert into auth.users values($1,$2,null)',['33333333-3333-3333-3333-333333333333',{...metadata,requested_kvk:'abc'}]),/check constraint/);
  const company=(await db.query("insert into public.companies(name,kvk_number) values('Edwin Coenen','77328949') returning *")).rows[0];
  assert.equal(Number(company.customer_number),1);
  await assert.rejects(db.exec("insert into public.companies(name,kvk_number) values('Duplicate','77328949')"),/unique constraint/);
  const next=(await db.query("insert into public.companies(name,kvk_number) values('Other','12345678') returning customer_number")).rows[0];
  assert.ok(Number(next.customer_number)>1); // Identity sequences can have gaps after failed transactions.
  await assert.rejects(db.query("update public.profiles set status='approved',reviewed_at=now() where id=$1",[user]),/check constraint/);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  assert.equal((await db.query('select * from public.profiles')).rows.length,1);
  assert.equal((await db.query('select * from public.companies')).rows.length,0);
  await assert.rejects(db.exec("update public.profiles set status='approved'"),/permission denied/);
  await assert.rejects(db.exec("insert into public.companies(name,kvk_number) values('Forged','99999999')"),/permission denied/);
  await db.exec('reset role');
  // Email confirmation alone cannot approve the profile.
  await db.query('update auth.users set email_confirmed_at=now() where id=$1',[user]);
  assert.equal((await db.query('select status from public.profiles where id=$1',[user])).rows[0].status,'pending');
  await db.query("update public.profiles set status='approved',company_id=$1,reviewed_at=now() where id=$2",[company.id,user]);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  assert.equal((await db.query('select * from public.companies')).rows.length,1);
  await db.exec('reset role');
  await db.query("update public.profiles set status='suspended' where id=$1",[user]);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`);
  assert.equal((await db.query('select * from public.companies')).rows.length,0);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.exec('select * from public.profiles'),/permission denied/);
 } finally {await db.close();}
});
