-- One explicitly selected invoice trial per administration; no automatic billing of old test orders.
begin;
create table private.moneybird_invoice_trials (
 administration_id text primary key check(administration_id ~ '^[0-9]{1,40}$'),order_id uuid unique not null references public.orders(id),
 company_id uuid not null references public.companies(id),created_by uuid not null references auth.users(id),
 reference text not null,request_snapshot jsonb not null,status text not null check(status in ('prepared','creating','create_uncertain','create_rejected','blocked','draft','sending','send_uncertain','send_rejected','sent')),
 invoice_id text,invoice_snapshot jsonb,review_hash text,sent_at timestamptz,send_unresolved boolean not null default false,
 last_error text,lease_owner uuid,lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(reference='BRB-PROEF-'||order_id::text)
);
create table private.moneybird_invoice_trial_events (
 id uuid primary key default gen_random_uuid(),administration_id text not null,order_id uuid not null references public.orders(id),
 actor_id uuid not null references auth.users(id),action text not null,status text not null,invoice_id text,created_at timestamptz not null default now()
);
alter table private.moneybird_invoice_trials enable row level security;
alter table private.moneybird_invoice_trial_events enable row level security;
revoke all on private.moneybird_invoice_trials,private.moneybird_invoice_trial_events from public,anon,authenticated;
create function private.moneybird_trial_source(p_actor_id uuid,p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype;v_company jsonb;v_link jsonb;v_items jsonb;v_email text;
begin
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED'; end if;
 select * into v_order from public.orders where id=p_order_id and user_id=p_actor_id and is_test;
 if v_order.id is null then raise exception 'INVOICE_OWN_TEST_ONLY'; end if;
 select lower(trim(email)) into v_email from auth.users where id=p_actor_id;
 select to_jsonb(c) into v_company from (select id,name,kvk_number from public.companies where id=v_order.company_id) c;
 select to_jsonb(l) into v_link from private.moneybird_company_links l where company_id=v_order.company_id;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') into v_items from public.order_items i where order_id=p_order_id;
 return jsonb_build_object('order',to_jsonb(v_order),'company',v_company,'link',v_link,'items',v_items,'buyer_email',v_email);
end;
$$;
revoke all on function private.moneybird_trial_source(uuid,uuid) from public,anon,authenticated;
create function public.admin_moneybird_invoice_trial(p_administration_id text,p_order_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_orders jsonb;v_probe private.moneybird_invoice_trials%rowtype;v_source jsonb;
begin
 if not public.is_app_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.accepted_at desc),'[]') into v_orders from (
 select id,order_number,company_name_snapshot,accepted_at from public.orders where user_id=auth.uid() and is_test order by accepted_at desc limit 50
 ) o;
 select * into v_probe from private.moneybird_invoice_trials where administration_id=p_administration_id;
 if p_order_id is not null then v_source:=private.moneybird_trial_source(auth.uid(),p_order_id);
 elsif v_probe.order_id is not null then v_source:=private.moneybird_trial_source(auth.uid(),v_probe.order_id); end if;
 return jsonb_build_object('orders',v_orders,'source',v_source,'probe',case when v_probe.order_id is null then null else to_jsonb(v_probe)-'lease_owner'-'lease_until' end);
end;
$$;
create function public.server_moneybird_invoice_trial(p_actor_id uuid,p_order_id uuid,p_administration_id text,p_owner uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_source jsonb;v_job private.moneybird_invoice_trials%rowtype;v_plan jsonb;v_amount bigint;v_vat bigint;v_total bigint;v_intent text:=p_data->>'intent';
begin
 v_source:=private.moneybird_trial_source(p_actor_id,p_order_id);
 if p_owner is null or coalesce(p_administration_id,'') !~ '^[0-9]{1,40}$' then raise exception 'INVOICE_PLAN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('moneybird-invoice-trial:'||p_administration_id,0));
 select * into v_job from private.moneybird_invoice_trials where administration_id=p_administration_id for update;
 if v_job.order_id is not null and v_job.order_id<>p_order_id then raise exception 'INVOICE_TRIAL_TAKEN'; end if;
 if p_action='reserve' then
  if v_job.lease_until>now() then return jsonb_build_object('acquired',false); end if;
  if v_job.order_id is null and v_intent<>'create' then raise exception 'INVOICE_PROBE_MISSING'; end if;
  if v_job.order_id is null or v_intent='create' and v_job.status in ('prepared','create_rejected') then
   v_plan:=p_data->'plan';
   select sum((i->>'amount_cents')::bigint),sum((i->>'vat_cents')::bigint),sum((i->>'total_cents')::bigint) into v_amount,v_vat,v_total from jsonb_array_elements(v_source->'items') i;
   if v_plan is null or v_plan->>'order_id' is distinct from p_order_id::text or v_plan->>'administration_id' is distinct from p_administration_id or v_plan->>'company_id' is distinct from v_source->'company'->>'id' or v_plan->>'contact_id' is distinct from v_source->'link'->>'contact_id' or (v_plan->>'link_revision')::integer is distinct from (v_source->'link'->>'revision')::integer or v_source->'link'->>'administration_id' is distinct from p_administration_id or v_plan->>'recipient_email' is distinct from v_source->>'buyer_email' or (v_plan->>'amount_cents')::bigint is distinct from v_amount or (v_plan->>'vat_cents')::bigint is distinct from v_vat or (v_plan->>'total_cents')::bigint is distinct from v_total or v_total is null or v_total<=0 or v_plan->>'reference' is distinct from 'BRB-PROEF-'||p_order_id::text then raise exception 'INVOICE_PLAN'; end if;
   if v_job.order_id is null then
    insert into private.moneybird_invoice_trials(administration_id,order_id,company_id,created_by,reference,request_snapshot,status)
    values(p_administration_id,p_order_id,(v_source->'company'->>'id')::uuid,p_actor_id,v_plan->>'reference',v_plan,'prepared') returning * into v_job;
   else update private.moneybird_invoice_trials set request_snapshot=v_plan,status='prepared',last_error=null where administration_id=p_administration_id returning * into v_job; end if;
  end if;
  update private.moneybird_invoice_trials set lease_owner=p_owner,lease_until=now()+interval '2 minutes',updated_at=now() where administration_id=p_administration_id returning * into v_job;
  return jsonb_build_object('acquired',true,'job',to_jsonb(v_job));
 end if;
 if v_job.order_id is null then raise exception 'INVOICE_PROBE_MISSING'; end if;
 if v_job.lease_owner is distinct from p_owner then raise exception 'INVOICE_BUSY'; end if;
 if p_action in ('creating','sending') then
  if not exists(select 1 from private.moneybird_connection where encrypted_tokens is not null and not reconnect_required and administration_id=p_administration_id) then raise exception 'CONNECTION_REQUIRED'; end if;
  if v_job.request_snapshot->>'recipient_email' is distinct from v_source->>'buyer_email' or v_job.request_snapshot->>'contact_id' is distinct from v_source->'link'->>'contact_id' or v_job.request_snapshot->>'contact_person_id' is distinct from v_source->'link'->'recipient_snapshot'->>'id' then raise exception 'INVOICE_LINK_CHANGED'; end if;
  if p_action='creating' then
   if v_job.status<>'prepared' or v_job.invoice_id is not null then raise exception 'INVOICE_ALREADY_STARTED'; end if;
   update private.moneybird_invoice_trials set status='creating',last_error=null where administration_id=p_administration_id;
  else
   if v_job.status<>'draft' or v_job.sent_at is not null or v_job.send_unresolved or v_job.review_hash is distinct from p_data->>'review_hash' then raise exception 'INVOICE_REVIEW_CHANGED'; end if;
   update private.moneybird_invoice_trials set status='sending',send_unresolved=true,last_error=null where administration_id=p_administration_id;
  end if;
 elsif p_action='record' then
  if coalesce(p_data->>'invoice_id','') !~ '^[0-9]{1,40}$' or v_job.invoice_id is not null and v_job.invoice_id<>p_data->>'invoice_id' then raise exception 'INVOICE_MISMATCH'; end if;
  update private.moneybird_invoice_trials set invoice_id=p_data->>'invoice_id',status=case when sent_at is not null then 'sent' else 'blocked' end where administration_id=p_administration_id;
 elsif p_action='verified' then
  if p_data->'invoice'->>'id' is distinct from v_job.invoice_id then raise exception 'INVOICE_MISMATCH'; end if;
  update private.moneybird_invoice_trials set invoice_snapshot=p_data->'invoice',review_hash=p_data->>'review_hash',
  status=case when not coalesce((p_data->>'valid')::boolean,false) then 'blocked' when sent_at is not null or (p_data->>'issued')::boolean then 'sent' when send_unresolved then 'send_uncertain' else 'draft' end,
  sent_at=case when coalesce((p_data->>'issued')::boolean,false) then coalesce(sent_at,now()) else sent_at end,
  send_unresolved=case when coalesce((p_data->>'issued')::boolean,false) then false else send_unresolved end,
  last_error=case when coalesce((p_data->>'valid')::boolean,false) then null else 'INVOICE_MISMATCH' end where administration_id=p_administration_id;
 elsif p_action in ('uncertain','rejected') then
  if p_data->>'phase'='create' and v_job.sent_at is null and v_job.status in ('creating','create_uncertain','blocked') then
   update private.moneybird_invoice_trials set status=case when invoice_id is not null then 'blocked' when p_action='rejected' then 'create_rejected' else 'create_uncertain' end,last_error=left(p_data->>'error',100) where administration_id=p_administration_id;
  elsif p_data->>'phase'='send' and v_job.sent_at is null and v_job.send_unresolved then
   update private.moneybird_invoice_trials set status=case when p_action='rejected' then 'send_rejected' else 'send_uncertain' end,send_unresolved=(p_action<>'rejected'),last_error=left(p_data->>'error',100) where administration_id=p_administration_id;
  else raise exception 'INVOICE_PLAN'; end if;
 elsif p_action='release' then
  update private.moneybird_invoice_trials set lease_owner=null,lease_until=null where administration_id=p_administration_id;return jsonb_build_object('released',true);
 else raise exception 'INVOICE_PLAN'; end if;
 update private.moneybird_invoice_trials set updated_at=now() where administration_id=p_administration_id returning * into v_job;
 insert into private.moneybird_invoice_trial_events(administration_id,order_id,actor_id,action,status,invoice_id) values(p_administration_id,p_order_id,p_actor_id,p_action,v_job.status,v_job.invoice_id);
 return to_jsonb(v_job)-'lease_owner'-'lease_until';
end;
$$;
revoke all on function public.admin_moneybird_invoice_trial(text,uuid) from public,anon;
grant execute on function public.admin_moneybird_invoice_trial(text,uuid) to authenticated;
revoke all on function public.server_moneybird_invoice_trial(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_moneybird_invoice_trial(uuid,uuid,text,uuid,text,jsonb) to service_role;
create function public.company_order_invoice_trials(p_order_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;
begin
 if cardinality(p_order_ids)>50 then raise exception 'INVALID_FILTER'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('order_id',t.order_id,'status',t.status,'invoice_number',t.invoice_snapshot->>'invoice_number','sent_at',t.sent_at)),'[]') into v_rows
 from private.moneybird_invoice_trials t join public.orders o on o.id=t.order_id
 join public.profiles p on p.company_id=o.company_id and p.id=auth.uid() and p.status='approved'
 join auth.users u on u.id=p.id and u.email_confirmed_at is not null where t.order_id=any(p_order_ids);
 return v_rows;
end;
$$;
revoke all on function public.company_order_invoice_trials(uuid[]) from public,anon;
grant execute on function public.company_order_invoice_trials(uuid[]) to authenticated;
commit;
