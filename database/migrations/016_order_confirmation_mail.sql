-- Transactional order-mail outbox. Disabled by default; no historical backfill.
-- Depends on accounts/orders, explicit admin (004/007), and customer_reference (014). Not on 006.
begin;
create table private.order_mail_settings (
 singleton boolean primary key default true check(singleton),auto_enabled boolean not null default false,
 changed_by uuid references auth.users(id),changed_at timestamptz,last_test_accepted_at timestamptz
);
insert into private.order_mail_settings(singleton) values(true);
create table private.order_confirmation_mail (
 order_id uuid primary key references public.orders(id),recipient text not null,customer_name text not null,
 status text not null default 'pending' check(status in ('pending','sending','accepted','partial','failed','uncertain')),
 payload jsonb,owner uuid,attempts integer not null default 0,accepted jsonb,last_error text,
 created_at timestamptz not null default now(),attempted_at timestamptz,finished_at timestamptz
);
create table private.order_mail_tests (
 id uuid primary key,actor_id uuid not null references auth.users(id),recipient text not null,
 status text not null default 'pending' check(status in ('pending','sending','accepted','partial','failed','uncertain')),
 owner uuid,accepted jsonb,last_error text,created_at timestamptz not null default now(),finished_at timestamptz
);
alter table private.order_mail_settings enable row level security;
alter table private.order_confirmation_mail enable row level security;
alter table private.order_mail_tests enable row level security;
revoke all on private.order_mail_settings,private.order_confirmation_mail,private.order_mail_tests from public,anon,authenticated;
create function private.enqueue_order_confirmation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select auto_enabled from private.order_mail_settings where singleton for share) then
  insert into private.order_confirmation_mail(order_id,recipient,customer_name)
  select o.id,u.email,p.full_name from public.orders o join auth.users u on u.id=o.user_id join public.profiles p on p.id=u.id
  where o.id=new.order_id and u.email_confirmed_at is not null on conflict(order_id) do nothing;
 end if;
 return new;
end;
$$;
revoke all on function private.enqueue_order_confirmation() from public,anon,authenticated;
create trigger enqueue_order_confirmation after insert on public.order_items for each row execute function private.enqueue_order_confirmation();
create function public.server_order_mail(p_actor_id uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_admin boolean;v_settings private.order_mail_settings%rowtype;v_job private.order_confirmation_mail%rowtype;v_test private.order_mail_tests%rowtype;v_order public.orders%rowtype;v_payload jsonb;v_rows jsonb;v_tests jsonb;v_actor_email text;v_owner uuid:=(p_data->>'owner')::uuid;v_id uuid:=(p_data->>'id')::uuid;v_status text:=p_data->>'status';
begin
 select exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) into v_admin;
 select email into v_actor_email from auth.users where id=p_actor_id and email_confirmed_at is not null;
 if p_action in ('status','enable','test_claim','test_finish') and not v_admin then raise exception 'ADMIN_REQUIRED'; end if;
 if p_action='status' then
  select * into v_settings from private.order_mail_settings where singleton;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc),'[]') into v_rows from (
   select q.order_id,o.order_number,o.company_name_snapshot,q.recipient,q.status,q.attempts,q.last_error,q.created_at,q.finished_at
   from private.order_confirmation_mail q join public.orders o on o.id=q.order_id order by q.created_at desc limit 30
  ) j;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc),'[]') into v_tests from (
   select id,recipient,status,last_error,created_at,finished_at from private.order_mail_tests order by created_at desc limit 5
  ) t;
  return jsonb_build_object('settings',to_jsonb(v_settings),'jobs',v_rows,'tests',v_tests);
 elsif p_action='enable' then
  if p_data->>'enabled' is null then raise exception 'MAIL_CONFIRMATION_REQUIRED'; end if;
  select * into v_settings from private.order_mail_settings where singleton for update;
  if (p_data->>'enabled')::boolean and ((p_data->>'confirmed_received')::boolean is distinct from true or v_settings.last_test_accepted_at is null) then raise exception 'MAIL_TEST_REQUIRED'; end if;
  update private.order_mail_settings set auto_enabled=(p_data->>'enabled')::boolean,changed_by=p_actor_id,changed_at=now() where singleton;
  return jsonb_build_object('auto_enabled',(p_data->>'enabled')::boolean);
 elsif p_action='test_claim' then
  if v_id is null or v_owner is null then raise exception 'MAIL_INVALID'; end if;
  insert into private.order_mail_tests(id,actor_id,recipient) values(v_id,p_actor_id,v_actor_email) on conflict(id) do nothing;
  select * into v_test from private.order_mail_tests where id=v_id for update;
  if v_test.actor_id<>p_actor_id or v_test.recipient<>v_actor_email then raise exception 'MAIL_FORBIDDEN'; end if;
  if v_test.status<>'pending' then return jsonb_build_object('claimed',false,'status',v_test.status); end if;
  update private.order_mail_tests set status='sending',owner=v_owner where id=v_id;
  return jsonb_build_object('claimed',true,'id',v_id,'recipient',v_actor_email);
 elsif p_action='test_finish' then
  if v_status not in ('accepted','partial','failed','uncertain') or v_owner is null then raise exception 'MAIL_INVALID'; end if;
  update private.order_mail_tests set status=v_status,accepted=p_data->'accepted',last_error=left(p_data->>'error_code',100),finished_at=now()
  where id=v_id and actor_id=p_actor_id and owner=v_owner and status='sending' returning * into v_test;
  if v_test.id is null then raise exception 'MAIL_CHANGED'; end if;
  if v_status='accepted' then update private.order_mail_settings set last_test_accepted_at=now() where singleton; end if;
  return jsonb_build_object('status',v_status);
 elsif p_action='claim' then
  if v_id is null or v_owner is null then raise exception 'MAIL_INVALID'; end if;
  select * into v_order from public.orders where id=v_id;
  if not v_admin and not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor_id and p.id=v_order.user_id and p.company_id=v_order.company_id and p.status='approved' and u.email_confirmed_at is not null) then return jsonb_build_object('claimed',false,'status','not_applicable'); end if;
  select * into v_settings from private.order_mail_settings where singleton for share;
  if not v_settings.auto_enabled then return jsonb_build_object('claimed',false,'status','disabled'); end if;
  select * into v_job from private.order_confirmation_mail where order_id=v_id for update;
  if v_job.order_id is null then return jsonb_build_object('claimed',false,'status','not_queued'); end if;
  if v_job.status not in ('pending','failed') then return jsonb_build_object('claimed',false,'status',v_job.status); end if;
  if v_job.payload is null then
   select jsonb_build_object('order_id',v_order.id,'order_number',v_order.order_number,'company_name',v_order.company_name_snapshot,'recipient',v_job.recipient,'customer_name',v_job.customer_name,'customer_reference',v_order.customer_reference,'is_test',v_order.is_test,'items',jsonb_agg(jsonb_build_object('drawing_title_snapshot',i.drawing_title_snapshot,'purpose_name_snapshot',i.purpose_name_snapshot,'amount_cents',i.amount_cents,'vat_cents',i.vat_cents,'total_cents',i.total_cents,'vat_percent',i.vat_percent,'currency',i.currency) order by i.id))
   into v_payload from public.order_items i where i.order_id=v_id;
  else v_payload:=v_job.payload; end if;
  update private.order_confirmation_mail set payload=v_payload,status='sending',owner=v_owner,attempts=attempts+1,attempted_at=now(),last_error=null where order_id=v_id;
  return jsonb_build_object('claimed',true,'payload',v_payload);
 elsif p_action='finish' then
  if v_status not in ('accepted','partial','failed','uncertain') or v_owner is null then raise exception 'MAIL_INVALID'; end if;
  update private.order_confirmation_mail set status=v_status,accepted=p_data->'accepted',last_error=left(p_data->>'error_code',100),finished_at=now()
  where order_id=v_id and owner=v_owner and status='sending' returning * into v_job;
  if v_job.order_id is null then raise exception 'MAIL_CHANGED'; end if;
  if not v_admin and v_order.id is null and not exists(select 1 from public.orders o where o.id=v_id and o.user_id=p_actor_id) then raise exception 'MAIL_FORBIDDEN'; end if;
  return jsonb_build_object('status',v_status);
 end if;
 raise exception 'MAIL_INVALID';
end;
$$;
revoke all on function public.server_order_mail(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_order_mail(uuid,text,jsonb) to service_role;
commit;
