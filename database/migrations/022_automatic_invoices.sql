-- Automatic creation and direct email delivery, prospective only. Starts OFF.
-- Existing orders/drafts/test orders are NEVER enrolled by this migration.
begin;
create table private.invoice_automation_settings(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 actor_id uuid references auth.users(id),administration_id text,activated_at timestamptz,updated_at timestamptz not null default now(),last_run_at timestamptz
);
insert into private.invoice_automation_settings(singleton) values(true);
alter table private.invoice_automation_settings enable row level security;
revoke all on private.invoice_automation_settings from public,anon,authenticated;
alter table private.order_invoice_jobs
 add column auto_eligible boolean not null default false,
 add column auto_owner uuid,add column auto_until timestamptz,
 add column auto_attempts integer not null default 0,
 add column auto_next_at timestamptz not null default now(),
 add column auto_last_error text,
 add column delivery_state text not null default 'pending' check(delivery_state in ('pending','sending','uncertain','rejected','sent','blocked')),
 add column sent_at timestamptz,
 add column alert_error text,add column alert_state text check(alert_state in ('pending','sending','sent','failed')),
 add column alert_at timestamptz;
-- Changing the default affects future trigger inserts only, not existing rows.
alter table private.order_invoice_jobs alter column auto_eligible set default true;
create index invoice_automation_due on private.order_invoice_jobs(auto_next_at) where auto_eligible and delivery_state<>'sent';
create function public.server_invoice_automation(p_action text,p_actor_id uuid default null,p_order_id uuid default null,p_owner uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.invoice_automation_settings%rowtype;j private.order_invoice_jobs%rowtype;r jsonb;c private.moneybird_connection%rowtype;v_enabled boolean;v_code text;v_rows jsonb;
begin
 select * into s from private.invoice_automation_settings where singleton;
 if p_action in ('settings','configure','retry','rows') then
  if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED';end if;
  if p_action='configure' then
   v_enabled:=(p_data->>'enabled')::boolean;
   if v_enabled is null then raise exception 'AUTOMATION_INVALID';end if;
   if v_enabled then
    select * into c from private.moneybird_connection where encrypted_tokens is not null and not reconnect_required;
    if c.administration_id is null then raise exception 'CONNECTION_REQUIRED';end if;
    if s.administration_id is not null and s.administration_id<>c.administration_id then raise exception 'AUTOMATION_ADMINISTRATION_CHANGED';end if;
   end if;
   update private.invoice_automation_settings set enabled=v_enabled,
    actor_id=case when v_enabled then p_actor_id else actor_id end,
    administration_id=case when v_enabled then c.administration_id else administration_id end,
    activated_at=case when v_enabled then coalesce(activated_at,now()) else activated_at end,updated_at=now() where singleton returning * into s;
  elsif p_action='retry' then
   -- A retry does not reset a creation or sending fence. Uncertain sends remain read-only recovery.
   update private.order_invoice_jobs set auto_attempts=0,auto_next_at=now()
    where order_id=p_order_id and auto_eligible and delivery_state<>'sent' and (auto_until is null or auto_until<now())
     and created_at>=s.activated_at;
   if not found then raise exception 'AUTOMATION_NOT_ELIGIBLE';end if;
  elsif p_action='rows' then
   select coalesce(jsonb_agg(jsonb_build_object('order_id',order_id,'delivery_state',delivery_state,'sent_at',sent_at,'auto_eligible',auto_eligible and created_at>=s.activated_at,'auto_attempts',auto_attempts,'auto_last_error',auto_last_error,'auto_next_at',auto_next_at,'alert_state',alert_state)),'[]') into v_rows
   from private.order_invoice_jobs where order_id in (select value::uuid from jsonb_array_elements_text(p_data->'ids'));
   return v_rows;
  end if;
  return jsonb_build_object('enabled',s.enabled,'activated_at',s.activated_at,'administration_id',s.administration_id,'last_run_at',s.last_run_at,'notification_email','info@rechtbanktekeningen.nl');
 end if;
 if p_action in ('claim','claim_alert') and (not s.enabled or s.actor_id is null) then return null;end if;
 if p_action not in ('claim','claim_alert','error','release','finish_alert') and not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=s.actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'AUTOMATION_ADMIN_REQUIRED';end if;
 if p_action='claim' then
  if not s.enabled then return null;end if;
  if p_owner is null then raise exception 'AUTOMATION_INVALID';end if;
  update private.invoice_automation_settings set last_run_at=now() where singleton;
  select q.* into j from private.order_invoice_jobs q join public.orders o on o.id=q.order_id
   where q.auto_eligible and q.created_at>=s.activated_at and not o.is_test and q.delivery_state<>'sent'
    and q.auto_attempts<20 and q.auto_next_at<=now() and (q.auto_until is null or q.auto_until<now()) and (q.lease_until is null or q.lease_until<now())
   order by q.auto_next_at,q.created_at,q.order_id limit 1 for update of q skip locked;
  if j.order_id is null then return null;end if;
  update private.order_invoice_jobs set auto_owner=p_owner,auto_until=now()+interval '10 minutes',auto_attempts=auto_attempts+1 where order_id=j.order_id returning * into j;
  return jsonb_build_object('actor_id',s.actor_id,'administration_id',s.administration_id,'order_id',j.order_id,'job',to_jsonb(j),'source_error',case when not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=s.actor_id and p.status='approved' and u.email_confirmed_at is not null) then 'AUTOMATION_ADMIN_REQUIRED' else null end,'source',case when exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=s.actor_id and p.status='approved' and u.email_confirmed_at is not null) then private.order_invoice_source(s.actor_id,j.order_id) else null end);
 elsif p_action='claim_alert' then
  if p_owner is null then raise exception 'AUTOMATION_INVALID';end if;
  select * into j from private.order_invoice_jobs where alert_state='pending' order by auto_next_at,order_id limit 1 for update skip locked;
  if j.order_id is null then return null;end if;
  -- At most one automatic SMTP attempt per distinct error; unknown outcomes are not spammed.
  update private.order_invoice_jobs set alert_state='sending',alert_at=now() where order_id=j.order_id;
  return jsonb_build_object('order_id',j.order_id,'order_number',(select order_number from public.orders where id=j.order_id),'error',j.alert_error);
 end if;
 select * into j from private.order_invoice_jobs where order_id=p_order_id for update;
 if p_action='finish_alert' then
  if j.alert_state<>'sending' then raise exception 'AUTOMATION_INVALID';end if;
  update private.order_invoice_jobs set alert_state=case when (p_data->>'accepted')::boolean then 'sent' else 'failed' end where order_id=p_order_id;
  return '{}';
 end if;
 if j.order_id is null or j.auto_owner is distinct from p_owner then raise exception 'AUTOMATION_BUSY';end if;
 if p_action='release' then
  update private.order_invoice_jobs set auto_owner=null,auto_until=null,auto_next_at=now()+make_interval(secs=>least(21600,300*power(2,least(auto_attempts-1,7))::integer)) where order_id=p_order_id;
  return '{}';
 end if;
 if j.auto_until<now() then raise exception 'AUTOMATION_BUSY';end if;
 if p_action='step' then
  if p_data->>'action' in ('reserve','creating') and not s.enabled then raise exception 'AUTOMATION_PAUSED';end if;
  r:=public.server_order_invoices(s.actor_id,p_data->>'action',p_order_id,p_owner,coalesce(p_data->'data','{}'));
  return r;
 elsif p_action='sending' then
  if not s.enabled then raise exception 'AUTOMATION_PAUSED';end if;
  if j.delivery_state not in ('pending','rejected') or j.ever_issued or j.status<>'draft' or j.invoice_id is null or j.lease_until>now() then raise exception 'INVOICE_SEND_UNCERTAIN';end if;
  if j.administration_id is distinct from s.administration_id or not exists(select 1 from private.moneybird_connection where administration_id=j.administration_id and encrypted_tokens is not null and not reconnect_required) then raise exception 'AUTOMATION_ADMINISTRATION_CHANGED';end if;
  if not exists(select 1 from private.moneybird_company_links where company_id=(select company_id from public.orders where id=j.order_id) and administration_id=j.administration_id and contact_id=j.request_snapshot->>'contact_id' and revision=(j.request_snapshot->>'link_revision')::integer) then raise exception 'ORDER_INVOICE_PLAN_CHANGED';end if;
  if p_data->'invoice'->>'id' is distinct from j.invoice_id or p_data->'invoice'->>'state' is distinct from 'draft' then raise exception 'ORDER_INVOICE_MISMATCH';end if;
  update private.order_invoice_jobs set delivery_state='sending',lease_owner=p_owner,lease_until=now()+interval '3 minutes' where order_id=p_order_id;
 elsif p_action in ('send_uncertain','send_rejected') then
  if j.delivery_state<>'sending' then raise exception 'AUTOMATION_INVALID';end if;
  update private.order_invoice_jobs set delivery_state=case when p_action='send_rejected' then 'rejected' else 'uncertain' end,lease_owner=null,lease_until=null where order_id=p_order_id;
 elsif p_action='sent' then
  if p_data->'invoice'->>'id' is distinct from j.invoice_id or p_data->'invoice'->>'sent_at' is null then raise exception 'ORDER_INVOICE_MISMATCH';end if;
  update private.order_invoice_jobs set delivery_state='sent',sent_at=(p_data->'invoice'->>'sent_at')::timestamptz,invoice_snapshot=p_data->'invoice',status='issued',ever_issued=true,auto_last_error=null,last_error=null,checked_at=now(),lease_owner=null,lease_until=null where order_id=p_order_id;
 elsif p_action='error' then
  v_code:=coalesce(nullif(left(p_data->>'code',100),''),'AUTOMATION_UNAVAILABLE');
  if v_code !~ '^[A-Z_]+$' then v_code:='AUTOMATION_UNAVAILABLE';end if;
  update private.order_invoice_jobs set auto_last_error=v_code,
   alert_state=case when alert_error is distinct from v_code then 'pending' else alert_state end,
   alert_error=v_code where order_id=p_order_id;
 else raise exception 'AUTOMATION_INVALID';end if;
 insert into private.order_invoice_events(order_id,actor_id,action,snapshot) values(p_order_id,s.actor_id,'auto_'||p_action,p_data);
 return (select to_jsonb(q)-array['auto_owner','auto_until','lease_owner','lease_until'] from private.order_invoice_jobs q where order_id=p_order_id);
end;
$$;
revoke all on function public.server_invoice_automation(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.server_invoice_automation(text,uuid,uuid,uuid,jsonb) to service_role;
-- Preserve existing manual controls, adding delivery/error visibility to both histories.
create or replace function public.server_order_invoices(p_actor_id uuid,p_action text,p_order_id uuid default null,p_owner uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.order_invoice_jobs%rowtype;v_source jsonb;v_plan jsonb;v_amount bigint;v_vat bigint;v_total bigint;v_rows jsonb;v_count bigint;v_page integer:=coalesce((p_data->>'page')::integer,1);v_filter text:=coalesce(p_data->>'status','all');v_intent text:=p_data->>'intent';v_issued boolean;
begin
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED';end if;
 if p_action='overview' then
  if v_page not between 1 and 10000 or v_filter not in ('all','queued','draft','issued','attention') then raise exception 'ORDER_INVOICE_INVALID';end if;
  select count(*) into v_count from private.order_invoice_jobs q where v_filter='all' or q.status=v_filter or v_filter='attention' and (q.status in ('prepared','creating','create_uncertain','create_rejected','blocked') or q.last_error is not null or q.auto_last_error is not null or q.delivery_state in ('sending','uncertain','rejected','blocked'));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.accepted_at desc,r.order_id),'[]') into v_rows from (
   select q.order_id,o.order_number,o.company_name_snapshot,o.customer_reference,o.accepted_at,q.status,q.invoice_id,q.administration_id,q.last_error,q.checked_at,q.ever_issued,q.delivery_state,q.sent_at,q.auto_last_error,q.auto_attempts,(q.auto_eligible and q.created_at>=(select activated_at from private.invoice_automation_settings where singleton)) as auto_eligible,q.alert_state,
   (select sum(total_cents) from public.order_items where order_id=o.id) total_cents
   from private.order_invoice_jobs q join public.orders o on o.id=q.order_id
   where v_filter='all' or q.status=v_filter or v_filter='attention' and (q.status in ('prepared','creating','create_uncertain','create_rejected','blocked') or q.last_error is not null or q.auto_last_error is not null or q.delivery_state in ('sending','uncertain','rejected','blocked'))
   order by o.accepted_at desc,q.order_id limit 20 offset (v_page-1)*20
  ) r;
  return jsonb_build_object('orders',v_rows,'page',v_page,'total',v_count,'has_more',v_page*20<v_count);
 end if;
 v_source:=private.order_invoice_source(p_actor_id,p_order_id);
 select * into j from private.order_invoice_jobs where order_id=p_order_id for update;
 if p_action='detail' then return jsonb_build_object('source',v_source,'job',(to_jsonb(j)-array['lease_owner','lease_until','auto_owner','auto_until'])||jsonb_build_object('auto_eligible',j.auto_eligible and j.created_at>=(select activated_at from private.invoice_automation_settings where singleton)));end if;
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
create or replace function public.company_order_invoices(p_order_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not public.portal_approved() then raise exception 'APPROVAL_REQUIRED';end if;
 if cardinality(p_order_ids)>100 then raise exception 'ORDER_INVOICE_INVALID';end if;
 select coalesce(jsonb_agg(jsonb_build_object('order_id',j.order_id,'status',j.status,'invoice_number',j.invoice_snapshot->>'invoice_number','checked_at',j.checked_at,'delivery_state',case when j.invoice_snapshot->>'sent_at' is not null then 'sent' else j.delivery_state end,'sent_at',coalesce(j.sent_at::text,j.invoice_snapshot->>'sent_at'))),'[]') into v_result
 from private.order_invoice_jobs j join public.orders o on o.id=j.order_id join public.profiles p on p.company_id=o.company_id and p.id=auth.uid()
 where j.order_id=any(p_order_ids);
 return v_result;
end;
$$;
commit;
