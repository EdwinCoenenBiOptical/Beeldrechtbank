-- Durable, admin-only contact creation ledger. Never retry ambiguous external writes blindly.
begin;
create table private.moneybird_contact_creations (
 company_id uuid not null references public.companies(id),administration_id text not null check(administration_id ~ '^[0-9]{1,40}$'),
 customer_id text not null,status text not null check(status in ('prepared','sending','uncertain','created','linked','rejected')),
 request_snapshot jsonb not null,requested_by uuid not null references auth.users(id),
 contact_id text,contact_snapshot jsonb,last_error text,
 lease_owner uuid,lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(company_id,administration_id),unique(administration_id,customer_id)
);
alter table private.moneybird_contact_creations enable row level security;
revoke all on private.moneybird_contact_creations from public,anon,authenticated;
create function public.admin_moneybird_contact_creation(p_company_id uuid,p_administration_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not public.is_app_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select jsonb_build_object('status',status,'customer_id',customer_id,'request_snapshot',request_snapshot,'contact_id',contact_id,'last_error',last_error,'updated_at',updated_at)
 into v_result from private.moneybird_contact_creations where company_id=p_company_id and administration_id=p_administration_id;
 return v_result;
end;
$$;
create function public.server_moneybird_contact_creation(p_actor_id uuid,p_company_id uuid,p_administration_id text,p_owner uuid,p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_job private.moneybird_contact_creations%rowtype;v_company public.companies%rowtype;v_link private.moneybird_company_links%rowtype;v_snapshot jsonb;v_result jsonb;
begin
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED'; end if;
 if p_owner is null or coalesce(p_administration_id,'') !~ '^[0-9]{1,40}$' then raise exception 'INVALID_CREATION'; end if;
 -- Lock in the same order as company mapping: company, then ledger.
 select * into v_company from public.companies where id=p_company_id for update;
 if v_company.id is null then raise exception 'COMPANY_MISSING'; end if;
 select * into v_job from private.moneybird_contact_creations where company_id=p_company_id and administration_id=p_administration_id for update;
 if p_action='reserve' then
  select * into v_link from private.moneybird_company_links where company_id=p_company_id;
  if v_link.company_id is not null then raise exception 'COMPANY_ALREADY_LINKED'; end if;
  if v_job.company_id is not null and v_job.lease_until>now() then return jsonb_build_object('acquired',false); end if;
  if coalesce((p_data->>'resume')::boolean,false) then
   if v_job.company_id is null then raise exception 'CREATION_MISSING'; end if;
  else
   v_snapshot:=p_data->'draft';
   if v_snapshot is null or jsonb_typeof(v_snapshot)<>'object' or v_snapshot->>'company_name' is distinct from trim(v_company.name) or v_snapshot->>'chamber_of_commerce' is distinct from v_company.kvk_number then raise exception 'COMPANY_CHANGED'; end if;
   if v_job.company_id is null then
    insert into private.moneybird_contact_creations(company_id,administration_id,customer_id,status,request_snapshot,requested_by)
    values(p_company_id,p_administration_id,'BRB-'||p_company_id::text,'prepared',v_snapshot,p_actor_id) returning * into v_job;
   elsif v_job.status in ('prepared','rejected') then
    update private.moneybird_contact_creations set status='prepared',request_snapshot=v_snapshot,requested_by=p_actor_id,last_error=null,updated_at=now()
    where company_id=p_company_id and administration_id=p_administration_id returning * into v_job;
   end if;
  end if;
  update private.moneybird_contact_creations set lease_owner=p_owner,lease_until=now()+interval '2 minutes'
  where company_id=p_company_id and administration_id=p_administration_id returning * into v_job;
  return jsonb_build_object('acquired',true,'job',to_jsonb(v_job));
 end if;
 if v_job.company_id is null then raise exception 'CREATION_MISSING'; end if;
 if v_job.lease_owner is distinct from p_owner then raise exception 'CREATION_BUSY'; end if;
 if p_action='sending' then
  if v_job.status<>'prepared' then raise exception 'CREATION_ALREADY_SENT'; end if;
  if not exists(select 1 from private.moneybird_connection where encrypted_tokens is not null and not reconnect_required and administration_id=p_administration_id) then raise exception 'CONNECTION_REQUIRED'; end if;
  if exists(select 1 from private.moneybird_company_links where company_id=p_company_id) then raise exception 'COMPANY_ALREADY_LINKED'; end if;
  if v_job.request_snapshot->>'company_name' is distinct from trim(v_company.name) or v_job.request_snapshot->>'chamber_of_commerce' is distinct from v_company.kvk_number then raise exception 'COMPANY_CHANGED'; end if;
  update private.moneybird_contact_creations set status='sending',last_error=null,updated_at=now() where company_id=p_company_id and administration_id=p_administration_id;
 elsif p_action in ('uncertain','rejected') then
  if v_job.status<>'sending' then raise exception 'INVALID_CREATION'; end if;
  update private.moneybird_contact_creations set status=p_action,last_error=left(p_data->>'error',100),updated_at=now() where company_id=p_company_id and administration_id=p_administration_id;
 elsif p_action='created' then
  v_snapshot:=p_data->'contact';
  if coalesce(v_snapshot->>'id','') !~ '^[0-9]{1,40}$' or regexp_replace(coalesce(v_snapshot->>'kvk',''),'[^0-9]','','g')<>v_job.request_snapshot->>'chamber_of_commerce' or (v_job.contact_id is null and v_snapshot->>'customer_id' is distinct from v_job.customer_id) then raise exception 'CONTACT_CREATED_MISMATCH'; end if;
  if v_job.contact_id is not null and v_snapshot->>'id'<>v_job.contact_id then raise exception 'CONTACT_CREATED_MISMATCH'; end if;
  update private.moneybird_contact_creations set status='created',contact_id=v_snapshot->>'id',contact_snapshot=v_snapshot,last_error=null,updated_at=now() where company_id=p_company_id and administration_id=p_administration_id;
 elsif p_action='link' then
  if v_job.status<>'created' or v_job.contact_id is null then raise exception 'INVALID_CREATION'; end if;
  if v_company.kvk_number<>v_job.request_snapshot->>'chamber_of_commerce' then raise exception 'COMPANY_CHANGED'; end if;
  select * into v_link from private.moneybird_company_links where company_id=p_company_id;
  if v_link.company_id is not null then
   if v_link.administration_id<>p_administration_id or v_link.contact_id<>v_job.contact_id then raise exception 'COMPANY_ALREADY_LINKED'; end if;
   v_result:=to_jsonb(v_link);
  else
   v_result:=public.server_link_moneybird_company(p_actor_id,p_company_id,p_administration_id,v_job.contact_id,v_job.contact_snapshot,
   jsonb_build_object('id',null,'name',nullif(v_job.contact_snapshot->>'attention',''),'email',nullif(v_job.contact_snapshot->>'invoice_email','')),0,'Contact aangemaakt vanuit het portalbeheer');
  end if;
  update private.moneybird_contact_creations set status='linked',last_error=null,updated_at=now() where company_id=p_company_id and administration_id=p_administration_id;
  return jsonb_build_object('link',v_result,'created',true);
 elsif p_action='release' then
  update private.moneybird_contact_creations set lease_owner=null,lease_until=null where company_id=p_company_id and administration_id=p_administration_id;
 else raise exception 'INVALID_CREATION';
 end if;
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.admin_moneybird_contact_creation(uuid,text) from public,anon;
grant execute on function public.admin_moneybird_contact_creation(uuid,text) to authenticated;
revoke all on function public.server_moneybird_contact_creation(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_moneybird_contact_creation(uuid,uuid,text,uuid,text,jsonb) to service_role;
commit;
