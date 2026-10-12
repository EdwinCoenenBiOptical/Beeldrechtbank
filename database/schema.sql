-- Proposed Supabase model. Review and apply when connecting the project.
create table public.companies (
 id uuid primary key default gen_random_uuid(), name text not null,
 created_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id), company_id uuid references public.companies(id),
 full_name text not null, status text not null default 'pending' check (status in ('pending','approved','suspended')),
 check (status <> 'approved' or company_id is not null)
);
create table public.usage_purposes (
 id uuid primary key default gen_random_uuid(), name text unique not null, active boolean not null default true
);
insert into public.usage_purposes(name) values ('Online'),('Print'),('TV');
create table public.company_prices (
 company_id uuid references public.companies(id), purpose_id uuid references public.usage_purposes(id),
 amount_cents integer not null check(amount_cents>=0), currency text not null default 'EUR' check(currency='EUR'),
 primary key(company_id,purpose_id)
);
create table public.drawings (
 id uuid primary key default gen_random_uuid(), title text not null, preview_path text not null,
 original_path text not null, metadata jsonb not null default '{}', published boolean not null default false
);
create table public.agreement_versions (
 id uuid primary key default gen_random_uuid(), body text not null, created_at timestamptz not null default now()
);
create table public.download_agreements (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 company_id uuid not null references public.companies(id), drawing_id uuid not null references public.drawings(id),
 purpose_id uuid not null references public.usage_purposes(id), agreement_version_id uuid not null references public.agreement_versions(id),
 company_name_snapshot text not null, purpose_name_snapshot text not null, agreement_text_snapshot text not null,
 amount_cents integer not null check(amount_cents>=0), currency text not null default 'EUR' check(currency='EUR'),
 accepted_at timestamptz not null default now()
);
-- Default deny until authenticated APIs and reviewed policies are implemented.
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.usage_purposes enable row level security;
alter table public.company_prices enable row level security;
alter table public.drawings enable row level security;
alter table public.agreement_versions enable row level security;
alter table public.download_agreements enable row level security;
-- Never expose original_path through the public catalogue API.
-- Keep originals in a private bucket. The server must atomically resolve the
-- approved profile, active purpose, company price and agreement version,
-- persist snapshots, then issue a short-lived download URL.
-- Users must never approve profiles or supply authoritative prices themselves.
