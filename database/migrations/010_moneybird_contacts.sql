-- Company/contact mapping only. No invoices or external contact writes.
begin;
create table private.moneybird_company_links (
 company_id uuid primary key references public.companies(id),
 administration_id text not null check(administration_id ~ '^[0-9]{1,40}$'),
 contact_id text not null check(contact_id ~ '^[0-9]{1,40}$'),
 contact_snapshot jsonb not null check(jsonb_typeof(contact_snapshot)='object'),
 recipient_snapshot jsonb not null check(jsonb_typeof(recipient_snapshot)='object'),
 revision integer not null check(revision>0),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 unique(administration_id,contact_id)
);
create table private.moneybird_link_history (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 previous_link jsonb,new_link jsonb not null,reason text
);
alter table private.moneybird_company_links enable row level security;
alter table private.moneybird_link_history enable row level security;
revoke all on private.moneybird_company_links,private.moneybird_link_history from public,anon,authenticated;
create function public.admin_moneybird_company(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_company jsonb;v_link jsonb;
begin
 if not public.is_app_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select to_jsonb(c) into v_company from (select id,name,kvk_number,customer_number from public.companies where id=p_company_id) c;
 if v_company is null then raise exception 'COMPANY_MISSING'; end if;
 select to_jsonb(l) into v_link from private.moneybird_company_links l where company_id=p_company_id;
 return jsonb_build_object('company',v_company,'link',v_link);
end;
$$;
create function public.server_link_moneybird_company(p_actor_id uuid,p_company_id uuid,p_administration_id text,p_contact_id text,p_contact_snapshot jsonb,p_recipient_snapshot jsonb,p_expected_revision integer,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_old private.moneybird_company_links%rowtype;v_new private.moneybird_company_links%rowtype;v_kvk text;v_reason text:=nullif(trim(p_reason),'');
begin
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED'; end if;
 select kvk_number into v_kvk from public.companies where id=p_company_id for update;
 if v_kvk is null then raise exception 'COMPANY_MISSING'; end if;
 select * into v_old from private.moneybird_company_links where company_id=p_company_id;
 if p_expected_revision is null or p_expected_revision<>coalesce(v_old.revision,0) then raise exception 'LINK_CHANGED'; end if;
 if p_contact_snapshot is null or p_recipient_snapshot is null or jsonb_typeof(p_contact_snapshot)<>'object' or jsonb_typeof(p_recipient_snapshot)<>'object' or (p_contact_snapshot->>'id') is distinct from p_contact_id then raise exception 'INVALID_LINK'; end if;
 if (v_old.company_id is not null and (v_old.administration_id<>p_administration_id or v_old.contact_id<>p_contact_id)) or regexp_replace(coalesce(p_contact_snapshot->>'kvk',''),'[^0-9]','','g')<>v_kvk then
  if v_reason is null then raise exception 'LINK_REASON_REQUIRED'; end if;
 end if;
 if length(v_reason)>1000 then raise exception 'INVALID_LINK'; end if;
 begin
 insert into private.moneybird_company_links(company_id,administration_id,contact_id,contact_snapshot,recipient_snapshot,revision,updated_by)
 values(p_company_id,p_administration_id,p_contact_id,p_contact_snapshot,p_recipient_snapshot,coalesce(v_old.revision,0)+1,p_actor_id)
 on conflict(company_id) do update set administration_id=excluded.administration_id,contact_id=excluded.contact_id,
 contact_snapshot=excluded.contact_snapshot,recipient_snapshot=excluded.recipient_snapshot,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now()
 returning * into v_new;
 exception when unique_violation then raise exception 'CONTACT_ALREADY_LINKED'; end;
 insert into private.moneybird_link_history(company_id,actor_id,previous_link,new_link,reason)
 values(p_company_id,p_actor_id,case when v_old.company_id is null then null else to_jsonb(v_old) end,to_jsonb(v_new),v_reason);
 return to_jsonb(v_new);
end;
$$;
revoke all on function public.admin_moneybird_company(uuid) from public,anon;
grant execute on function public.admin_moneybird_company(uuid) to authenticated;
revoke all on function public.server_link_moneybird_company(uuid,uuid,text,text,jsonb,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.server_link_moneybird_company(uuid,uuid,text,text,jsonb,jsonb,integer,text) to service_role;
commit;
