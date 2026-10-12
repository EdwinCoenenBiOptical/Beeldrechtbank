-- Account review UI; depends on migrations 001 and 004, NOT on notification migration 006.
begin;
create function public.is_app_admin() returns boolean language sql stable security definer set search_path='' as $$
 select public.is_onedrive_admin();
$$;
create table private.application_reviews (
 id uuid primary key default gen_random_uuid(), profile_id uuid references public.profiles(id) on delete set null,
 reviewer_id uuid not null references auth.users(id), decision text not null check(decision in ('approved','rejected')),
 company_id uuid references public.companies(id), reviewed_at timestamptz not null default now()
);
alter table private.application_reviews enable row level security;
revoke all on private.application_reviews from public,anon,authenticated;
create function public.admin_application_overview(p_page integer default 1,p_status text default 'pending') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;v_count bigint;
begin
 if not public.is_app_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if p_page<1 or p_page>100000 or p_status not in ('pending','approved','rejected','suspended') then raise exception 'INVALID_FILTER'; end if;
 select count(*) into v_count from public.profiles where status=p_status;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb) into v_rows from (
 select p.id,p.full_name,u.email,(u.email_confirmed_at is not null) as email_confirmed,p.status,
 p.requested_company_name,p.requested_kvk,p.created_at,p.reviewed_at,
 c.id as matching_company_id,c.name as matching_company_name,c.customer_number
 from public.profiles p join auth.users u on u.id=p.id
 left join public.companies c on c.kvk_number=p.requested_kvk
 where p.status=p_status order by p.created_at,p.id limit 10 offset (p_page-1)*10
 ) a;
 return jsonb_build_object('applications',v_rows,'page',p_page,'has_more',p_page*10<v_count,'total',v_count);
end;
$$;
create function public.admin_review_application(p_profile_id uuid,p_decision text,p_company_id uuid default null,p_company_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype;v_company uuid;v_name text;
begin
 if not public.is_app_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if p_profile_id=auth.uid() then raise exception 'SELF_REVIEW_FORBIDDEN'; end if;
 if p_decision not in ('approved','rejected') or p_decision is null then raise exception 'INVALID_DECISION'; end if;
 select * into v_profile from public.profiles where id=p_profile_id for update;
 if v_profile.id is null then raise exception 'APPLICATION_MISSING'; end if;
 if v_profile.status<>'pending' then raise exception 'APPLICATION_ALREADY_REVIEWED'; end if;
 if p_decision='approved' then
  if not exists(select 1 from auth.users where id=p_profile_id and email_confirmed_at is not null) then raise exception 'EMAIL_CONFIRMATION_REQUIRED'; end if;
  if p_company_id is not null then
   select id,name into v_company,v_name from public.companies where id=p_company_id and kvk_number=v_profile.requested_kvk;
   if v_company is null then raise exception 'COMPANY_MISMATCH'; end if;
  else
   select id,name into v_company,v_name from public.companies where kvk_number=v_profile.requested_kvk;
   if v_company is null then
    if p_company_name is null or length(trim(p_company_name)) not between 1 and 200 then raise exception 'COMPANY_NAME_REQUIRED'; end if;
    insert into public.companies(name,kvk_number) values(trim(p_company_name),v_profile.requested_kvk)
    on conflict(kvk_number) do nothing returning id,name into v_company,v_name;
    if v_company is null then select id,name into v_company,v_name from public.companies where kvk_number=v_profile.requested_kvk; end if;
   end if;
  end if;
 end if;
 update public.profiles set status=p_decision,company_id=v_company,reviewed_at=now() where id=p_profile_id;
 insert into private.application_reviews(profile_id,reviewer_id,decision,company_id) values(p_profile_id,auth.uid(),p_decision,v_company);
 return jsonb_build_object('status',p_decision,'company_name',v_name,'profile_id',p_profile_id);
end;
$$;
revoke all on function public.is_app_admin(),public.admin_application_overview(integer,text),public.admin_review_application(uuid,text,uuid,text) from public,anon;
grant execute on function public.is_app_admin(),public.admin_application_overview(integer,text),public.admin_review_application(uuid,text,uuid,text) to authenticated;
commit;
