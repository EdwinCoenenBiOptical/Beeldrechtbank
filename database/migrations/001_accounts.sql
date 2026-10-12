-- Execute this complete file in Supabase SQL Editor before registering users.
-- This is the first executable migration; database/schema.sql is a future sketch.
begin;
create table public.companies (
 id uuid primary key default gen_random_uuid(),
 customer_number bigint generated always as identity unique not null,
 name text not null check(length(trim(name)) between 1 and 200),
 kvk_number text unique not null check(kvk_number ~ '^[0-9]{8}$'),
 created_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 first_name text not null check(length(trim(first_name)) between 1 and 80),
 name_prefix text not null default '' check(length(name_prefix)<=40),
 last_name text not null check(length(trim(last_name)) between 1 and 100),
 full_name text generated always as (trim(first_name || ' ' || case when name_prefix='' then '' else name_prefix || ' ' end || last_name)) stored,
 requested_company_name text not null check(length(trim(requested_company_name)) between 1 and 200),
 requested_kvk text not null check(requested_kvk ~ '^[0-9]{8}$'),
 company_id uuid references public.companies(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected','suspended')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 check(status <> 'approved' or (company_id is not null and reviewed_at is not null))
);
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
-- Only the trusted SQL owner can write approvals and company assignments.
revoke all on public.companies, public.profiles from anon, authenticated;
grant select on public.companies, public.profiles to authenticated;
create policy "read own profile" on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy "read approved own company" on public.companies for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=companies.id and p.status='approved')
);
create function public.create_pending_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,first_name,name_prefix,last_name,requested_company_name,requested_kvk)
 values(new.id,trim(coalesce(new.raw_user_meta_data->>'first_name','')),
 trim(coalesce(new.raw_user_meta_data->>'name_prefix','')),
 trim(coalesce(new.raw_user_meta_data->>'last_name','')),
 trim(coalesce(new.raw_user_meta_data->>'requested_company_name','')),
 trim(coalesce(new.raw_user_meta_data->>'requested_kvk','')));
 -- Never trust company_id, status or role supplied through signup metadata.
 return new;
end;
$$;
revoke all on function public.create_pending_profile() from public,anon,authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_pending_profile();
commit;
