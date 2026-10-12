-- One current company per person; retain the original application and old purchases.
begin;
alter table private.application_reviews drop constraint application_reviews_decision_check;
alter table private.application_reviews add constraint application_reviews_decision_check check(decision in ('approved','rejected','reassigned'));
alter table private.application_reviews add column previous_company_id uuid references public.companies(id);
alter table private.application_reviews add column reason text;
alter table private.application_reviews add column requested_company_name_snapshot text;
alter table private.application_reviews add column requested_kvk_snapshot text;
create function public.admin_company_options(p_search text default '',p_include uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_options jsonb;v_count bigint;
begin
 if not public.is_app_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if p_search is null or length(p_search)>200 then raise exception 'INVALID_FILTER'; end if;
 select count(*) into v_count from public.companies where name ilike '%'||p_search||'%' or kvk_number ilike '%'||p_search||'%' or id=p_include;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.pinned desc,c.name,c.id),'[]'::jsonb) into v_options from (
 select id,name,kvk_number,customer_number,(id=p_include) is true as pinned from public.companies
 where name ilike '%'||p_search||'%' or kvk_number ilike '%'||p_search||'%' or id=p_include
 order by ((id=p_include) is true) desc,name,id limit 50
 ) c;
 return jsonb_build_object('companies',v_options,'has_more',v_count>50);
end;
$$;
create or replace function public.admin_application_overview(p_page integer default 1,p_status text default 'pending') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;v_count bigint;
begin
 if not public.is_app_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if p_page is null or p_status is null or p_page<1 or p_page>100000 or p_status not in ('pending','approved','rejected','suspended') then raise exception 'INVALID_FILTER'; end if;
 select count(*) into v_count from public.profiles where status=p_status;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb) into v_rows from (
 select p.id,p.full_name,u.email,(u.email_confirmed_at is not null) as email_confirmed,p.status,
 p.requested_company_name,p.requested_kvk,p.created_at,p.reviewed_at,
 c.id as matching_company_id,c.name as matching_company_name,c.customer_number,
 assigned.id as assigned_company_id,assigned.name as assigned_company_name,assigned.kvk_number as assigned_kvk
 from public.profiles p join auth.users u on u.id=p.id
 left join public.companies c on c.kvk_number=p.requested_kvk
 left join public.companies assigned on assigned.id=p.company_id
 where p.status=p_status order by p.created_at,p.id limit 10 offset (p_page-1)*10
 ) a;
 return jsonb_build_object('applications',v_rows,'page',p_page,'has_more',p_page*10<v_count,'total',v_count);
end;
$$;
create function public.admin_assign_person(p_profile_id uuid,p_action text,p_company_id uuid default null,
 p_company_name text default null,p_company_kvk text default null,p_reason text default null,
 p_expected_status text default null,p_expected_company_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype;v_company public.companies%rowtype;v_kvk text;v_status text;v_reason text:=nullif(trim(p_reason),'');
begin
 if not public.is_app_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if p_action is null or p_action not in ('approved','rejected','reassigned') then raise exception 'INVALID_DECISION'; end if;
 if p_profile_id=auth.uid() and p_action<>'reassigned' then raise exception 'SELF_REVIEW_FORBIDDEN'; end if;
 select * into v_profile from public.profiles where id=p_profile_id for update;
 if v_profile.id is null then raise exception 'APPLICATION_MISSING'; end if;
 if p_expected_status is not null and (v_profile.status is distinct from p_expected_status or v_profile.company_id is distinct from p_expected_company_id) then raise exception 'APPLICATION_CHANGED'; end if;
 if p_action='rejected' and v_profile.status<>'pending' then raise exception 'APPLICATION_ALREADY_REVIEWED'; end if;
 if p_action='approved' then
  if v_profile.status not in ('pending','rejected') then raise exception 'APPLICATION_ALREADY_REVIEWED'; end if;
  if not exists(select 1 from auth.users where id=p_profile_id and email_confirmed_at is not null) then raise exception 'EMAIL_CONFIRMATION_REQUIRED'; end if;
 end if;
 if p_action<>'rejected' then
  if p_company_id is not null then
   select * into v_company from public.companies where id=p_company_id;
   if v_company.id is null then raise exception 'COMPANY_MISSING'; end if;
  else
   v_kvk:=coalesce(p_company_kvk,v_profile.requested_kvk);
   if v_kvk !~ '^[0-9]{8}$' or v_kvk is null then raise exception 'COMPANY_KVK_REQUIRED'; end if;
   if p_company_name is null or length(trim(p_company_name)) not between 1 and 200 then raise exception 'COMPANY_NAME_REQUIRED'; end if;
   select * into v_company from public.companies where kvk_number=v_kvk;
   if v_company.id is not null then raise exception 'COMPANY_ALREADY_EXISTS'; end if;
   -- Never silently rename an existing company; handle concurrent creation.
   begin
    insert into public.companies(name,kvk_number) values(trim(p_company_name),v_kvk) returning * into v_company;
   exception when unique_violation then raise exception 'COMPANY_ALREADY_EXISTS';
   end;
  end if;
  if ((v_profile.company_id is not null and v_profile.company_id<>v_company.id) or v_company.kvk_number<>v_profile.requested_kvk) and v_reason is null then raise exception 'ASSIGNMENT_REASON_REQUIRED'; end if;
 end if;
 if length(v_reason)>1000 then raise exception 'ASSIGNMENT_REASON_TOO_LONG'; end if;
 v_status:=case when p_action='reassigned' then v_profile.status else p_action end;
 update public.profiles set company_id=case when p_action='rejected' then v_profile.company_id else v_company.id end,
 status=v_status,reviewed_at=now() where id=p_profile_id;
 insert into private.application_reviews(profile_id,reviewer_id,decision,company_id,previous_company_id,reason,requested_company_name_snapshot,requested_kvk_snapshot)
 values(p_profile_id,auth.uid(),p_action,case when p_action='rejected' then v_profile.company_id else v_company.id end,
 v_profile.company_id,v_reason,v_profile.requested_company_name,v_profile.requested_kvk);
 return jsonb_build_object('status',v_status,'company_name',v_company.name,'profile_id',p_profile_id,'action',p_action);
end;
$$;
revoke all on function public.admin_company_options(text,uuid),public.admin_assign_person(uuid,text,uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.admin_company_options(text,uuid),public.admin_assign_person(uuid,text,uuid,text,text,text,text,uuid) to authenticated;
commit;
