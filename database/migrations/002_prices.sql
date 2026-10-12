-- Execute once after 001_accounts.sql. No purchases/downloads are created.
begin;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;
create table public.usage_purposes (
 id uuid primary key default gen_random_uuid(),
 name text unique not null check(length(trim(name)) between 1 and 100),
 active boolean not null default true,
 sort_order integer not null default 0
);
insert into public.usage_purposes(name,sort_order) values ('Online',10),('Print',20),('TV',30);
create table public.company_prices (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 purpose_id uuid not null references public.usage_purposes(id),
 amount_cents integer not null check(amount_cents >= 0),
 currency text not null default 'EUR' check(currency='EUR'),
 valid_from date not null default current_date,
 valid_until date,
 created_at timestamptz not null default now(),
 check(valid_until is null or valid_until > valid_from),
 unique(company_id,purpose_id,valid_from),
 exclude using gist(company_id with =,purpose_id with =,daterange(valid_from,valid_until,'[)') with &&)
);
alter table public.usage_purposes enable row level security;
alter table public.company_prices enable row level security;
revoke all on public.usage_purposes,public.company_prices from anon,authenticated;
grant select on public.usage_purposes,public.company_prices to authenticated;
create policy "approved users read active purposes" on public.usage_purposes for select to authenticated using (
 active and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved' and p.company_id is not null)
);
create policy "approved users read own current prices" on public.company_prices for select to authenticated using (
 valid_from <= current_date and (valid_until is null or valid_until > current_date)
 and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved' and p.company_id=company_prices.company_id)
 and exists(select 1 from public.usage_purposes u where u.id=company_prices.purpose_id and u.active)
);
commit;
