-- Prospective invoice queue for real catalogue orders. No historical backfill and no automatic sending.
begin;
create table private.order_invoice_jobs(
 order_id uuid primary key references public.orders(id),
 status text not null default 'queued' check(status in ('queued','prepared','creating','create_uncertain','create_rejected','draft','issued','blocked')),
 administration_id text,invoice_id text,request_snapshot jsonb,invoice_snapshot jsonb,
 review_hash text,last_error text,ever_issued boolean not null default false,
 lease_owner uuid,lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),checked_at timestamptz,
 check(invoice_id is null or invoice_id ~ '^[0-9]{1,40}$'),check(administration_id is null or administration_id ~ '^[0-9]{1,40}$')
);
create unique index order_invoice_provider_unique on private.order_invoice_jobs(administration_id,invoice_id) where invoice_id is not null;
create table private.order_invoice_events(
 id bigint generated always as identity primary key,order_id uuid not null references private.order_invoice_jobs(order_id),
 actor_id uuid references auth.users(id),action text not null,snapshot jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table private.order_invoice_jobs enable row level security;
alter table private.order_invoice_events enable row level security;
revoke all on private.order_invoice_jobs,private.order_invoice_events from public,anon,authenticated;
create function private.enqueue_order_invoice() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.orders where id=new.order_id and not is_test) then
  insert into private.order_invoice_jobs(order_id) values(new.order_id) on conflict(order_id) do nothing;
 end if;
 return new;
end;
$$;
revoke all on function private.enqueue_order_invoice() from public,anon,authenticated;
create trigger enqueue_order_invoice after insert on public.order_items for each row execute function private.enqueue_order_invoice();
create function private.order_invoice_source(p_actor_id uuid,p_order_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.orders%rowtype;v_company jsonb;v_link jsonb;v_items jsonb;v_email text;
begin
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED';end if;
 select * into v_order from public.orders where id=p_order_id and not is_test;
 if v_order.id is null then raise exception 'ORDER_INVOICE_REAL_ONLY';end if;
 if not exists(select 1 from private.order_invoice_jobs where order_id=p_order_id) then raise exception 'ORDER_INVOICE_NOT_QUEUED';end if;
 select to_jsonb(c) into v_company from public.companies c where id=v_order.company_id;
 select to_jsonb(l) into v_link from private.moneybird_company_links l where company_id=v_order.company_id;
 select email into v_email from auth.users where id=v_order.user_id;
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('image_key',s.image_key) order by i.id),'[]') into v_items
 from public.order_items i left join private.catalogue_order_sources s on s.order_item_id=i.id where i.order_id=p_order_id;
 return jsonb_build_object('order',to_jsonb(v_order),'company',v_company,'link',v_link,'items',v_items,'buyer_email',v_email);
end;
$$;
revoke all on function private.order_invoice_source(uuid,uuid) from public,anon,authenticated;
create function public.server_order_invoices(p_actor_id uuid,p_action text,p_order_id uuid default null,p_owner uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.order_invoice_jobs%rowtype;v_source jsonb;v_plan jsonb;v_amount bigint;v_vat bigint;v_total bigint;v_rows jsonb;v_count bigint;v_page integer:=coalesce((p_data->>'page')::integer,1);v_filter text:=coalesce(p_data->>'status','all');v_intent text:=p_data->>'intent';v_issued boolean;
begin
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED';end if;
 if p_action='overview' then
  if v_page not between 1 and 10000 or v_filter not in ('all','queued','draft','issued','attention') then raise exception 'ORDER_INVOICE_INVALID';end if;
  select count(*) into v_count from private.order_invoice_jobs q where v_filter='all' or q.status=v_filter or v_filter='attention' and (q.status in ('prepared','creating','create_uncertain','create_rejected','blocked') or q.last_error is not null);
  select coalesce(jsonb_agg(to_jsonb(r) order by r.accepted_at desc,r.order_id),'[]') into v_rows from (
   select q.order_id,o.order_number,o.company_name_snapshot,o.customer_reference,o.accepted_at,q.status,q.invoice_id,q.administration_id,q.last_error,q.checked_at,q.ever_issued,
   (select sum(total_cents) from public.order_items where order_id=o.id) total_cents
   from private.order_invoice_jobs q join public.orders o on o.id=q.order_id
   where v_filter='all' or q.status=v_filter or v_filter='attention' and (q.status in ('prepared','creating','create_uncertain','create_rejected','blocked') or q.last_error is not null)
   order by o.accepted_at desc,q.order_id limit 20 offset (v_page-1)*20
  ) r;
  return jsonb_build_object('orders',v_rows,'page',v_page,'total',v_count,'has_more',v_page*20<v_count);
 end if;
 v_source:=private.order_invoice_source(p_actor_id,p_order_id);
 select * into j from private.order_invoice_jobs where order_id=p_order_id for update;
 if p_action='detail' then return jsonb_build_object('source',v_source,'job',to_jsonb(j)-array['lease_owner','lease_until']);end if;
 if p_owner is null then raise exception 'ORDER_INVOICE_INVALID';end if;
 if p_action='reserve' then
  if v_intent not in ('create','check') then raise exception 'ORDER_INVOICE_INVALID';end if;
  if j.lease_until>now() then return jsonb_build_object('acquired',false);end if;
  if j.status in ('queued','prepared','create_rejected') and j.invoice_id is null and v_intent='create' then
   v_plan:=p_data->'plan';
   select sum((i->>'amount_cents')::bigint),sum((i->>'vat_cents')::bigint),sum((i->>'total_cents')::bigint) into v_amount,v_vat,v_total from jsonb_array_elements(v_source->'items') i;
   if v_plan is null or v_plan->>'order_id' is distinct from p_order_id::text or v_plan->>'company_id' is distinct from v_source->'company'->>'id'
   or v_plan->>'reference' is distinct from coalesce(v_source->'order'->>'customer_reference','Beeldrechtbank bestelling '||(v_source->'order'->>'order_number'))
   or v_plan->>'contact_person_id' is distinct from v_source->'link'->'recipient_snapshot'->>'id' or v_plan->>'currency' is distinct from 'EUR' or v_plan->>'ledger_account_code' is distinct from '80300'
   or v_plan->>'administration_id' is distinct from v_source->'link'->>'administration_id' or v_plan->>'contact_id' is distinct from v_source->'link'->>'contact_id'
   or (v_plan->>'link_revision')::integer is distinct from (v_source->'link'->>'revision')::integer
   or (v_plan->>'amount_cents')::bigint is distinct from v_amount or (v_plan->>'vat_cents')::bigint is distinct from v_vat or (v_plan->>'total_cents')::bigint is distinct from v_total
   or v_total is null or v_total<=0 or v_plan->>'internal_reference' is distinct from 'BRB-BESTELLING-'||p_order_id::text then raise exception 'ORDER_INVOICE_PLAN_CHANGED';end if;
   update private.order_invoice_jobs set request_snapshot=v_plan,administration_id=v_plan->>'administration_id',status='prepared',last_error=null,updated_at=now() where order_id=p_order_id;
   insert into private.order_invoice_events(order_id,actor_id,action,snapshot) values(p_order_id,p_actor_id,'prepared',v_plan);
  end if;
  select * into j from private.order_invoice_jobs where order_id=p_order_id;
  if j.request_snapshot is null then raise exception 'ORDER_INVOICE_NOT_PREPARED';end if;
  update private.order_invoice_jobs set lease_owner=p_owner,lease_until=now()+interval '3 minutes' where order_id=p_order_id returning * into j;
  return jsonb_build_object('acquired',true,'job',to_jsonb(j));
 end if;
 if j.lease_owner is distinct from p_owner then raise exception 'ORDER_INVOICE_BUSY';end if;
 if p_action='creating' then
  if j.status not in ('prepared','create_rejected') or j.invoice_id is not null or j.ever_issued then raise exception 'ORDER_INVOICE_ALREADY_STARTED';end if;
  if j.request_snapshot->>'administration_id' is distinct from v_source->'link'->>'administration_id' or j.request_snapshot->>'contact_id' is distinct from v_source->'link'->>'contact_id' or (j.request_snapshot->>'link_revision')::integer is distinct from (v_source->'link'->>'revision')::integer then raise exception 'ORDER_INVOICE_PLAN_CHANGED';end if;
  if not exists(select 1 from private.moneybird_connection where encrypted_tokens is not null and not reconnect_required and administration_id=j.administration_id) then raise exception 'CONNECTION_REQUIRED';end if;
  update private.order_invoice_jobs set status='creating',last_error=null,updated_at=now() where order_id=p_order_id;
 elsif p_action in ('uncertain','rejected') then
  if j.invoice_id is not null or j.status<>'creating' then raise exception 'ORDER_INVOICE_ALREADY_STARTED';end if;
  update private.order_invoice_jobs set status=case when p_action='uncertain' then 'create_uncertain' else 'create_rejected' end,last_error=left(p_data->>'error',100),updated_at=now() where order_id=p_order_id;
 elsif p_action='record' then
  if coalesce(p_data->>'invoice_id','') !~ '^[0-9]{1,40}$' or j.invoice_id is not null and j.invoice_id<>p_data->>'invoice_id' then raise exception 'ORDER_INVOICE_MISMATCH';end if;
  update private.order_invoice_jobs set invoice_id=p_data->>'invoice_id',status=case when ever_issued then 'issued' else 'blocked' end,updated_at=now() where order_id=p_order_id;
 elsif p_action='verified' then
  if p_data->'invoice'->>'id' is distinct from j.invoice_id then raise exception 'ORDER_INVOICE_MISMATCH';end if;
  v_issued:=j.ever_issued or coalesce((p_data->>'issued')::boolean,false);
  update private.order_invoice_jobs set invoice_snapshot=p_data->'invoice',review_hash=p_data->>'review_hash',ever_issued=v_issued,
   status=case when v_issued then 'issued' when (p_data->>'valid')::boolean and p_data->'invoice'->>'state'='draft' then 'draft' else 'blocked' end,
   last_error=case when (p_data->>'valid')::boolean then null else 'ORDER_INVOICE_MISMATCH' end,checked_at=now(),updated_at=now() where order_id=p_order_id;
 elsif p_action='missing' then
  update private.order_invoice_jobs set status='blocked',last_error='INVOICE_MISSING',checked_at=now(),updated_at=now() where order_id=p_order_id;
 elsif p_action='unresolved' then
  update private.order_invoice_jobs set last_error='INVOICE_WRITE_UNCERTAIN',updated_at=now() where order_id=p_order_id;
 elsif p_action='release' then
  update private.order_invoice_jobs set lease_owner=null,lease_until=null where order_id=p_order_id;
 else raise exception 'ORDER_INVOICE_INVALID';end if;
 if p_action<>'release' then insert into private.order_invoice_events(order_id,actor_id,action,snapshot) values(p_order_id,p_actor_id,p_action,p_data);end if;
 select * into j from private.order_invoice_jobs where order_id=p_order_id;
 return to_jsonb(j)-array['lease_owner','lease_until'];
end;
$$;
revoke all on function public.server_order_invoices(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.server_order_invoices(uuid,text,uuid,uuid,jsonb) to service_role;
create function public.company_order_invoices(p_order_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not public.portal_approved() then raise exception 'APPROVAL_REQUIRED';end if;
 if cardinality(p_order_ids)>100 then raise exception 'ORDER_INVOICE_INVALID';end if;
 select coalesce(jsonb_agg(jsonb_build_object('order_id',j.order_id,'status',j.status,'invoice_number',j.invoice_snapshot->>'invoice_number','checked_at',j.checked_at)),'[]') into v_result
 from private.order_invoice_jobs j join public.orders o on o.id=j.order_id join public.profiles p on p.company_id=o.company_id and p.id=auth.uid()
 where j.order_id=any(p_order_ids);
 return v_result;
end;
$$;
revoke all on function public.company_order_invoices(uuid[]) from public,anon;
grant execute on function public.company_order_invoices(uuid[]) to authenticated;
commit;
