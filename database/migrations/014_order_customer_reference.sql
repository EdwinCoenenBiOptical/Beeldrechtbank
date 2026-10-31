-- Optional immutable PO/customer reference. Keep private recovery IDs separate from invoice 'reference'.
begin;
alter table public.orders add column customer_reference text
 check(customer_reference is null or (length(customer_reference)<=100 and customer_reference !~ '[[:cntrl:]]'));
-- Preserve the tested checkout implementation, accessible only through these wrappers.
alter function public.test_order_quote(text,uuid) set schema private;
alter function private.test_order_quote(text,uuid) rename to test_order_quote_without_reference;
alter function public.place_test_order(text,uuid,uuid,integer,text,boolean) set schema private;
alter function private.place_test_order(text,uuid,uuid,integer,text,boolean) rename to place_test_order_without_reference;
revoke all on function private.test_order_quote_without_reference(text,uuid),private.place_test_order_without_reference(text,uuid,uuid,integer,text,boolean) from public,anon,authenticated;
create function public.test_order_quote(p_drawing_key text,p_purpose_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_quote jsonb;v_reference text;
begin
 v_quote:=private.test_order_quote_without_reference(p_drawing_key,p_purpose_id);
 if coalesce((v_quote->>'owned')::boolean,false) then
  select customer_reference into v_reference from public.orders where id=(v_quote->>'order_id')::uuid;
  return v_quote||jsonb_build_object('customer_reference',v_reference);
 end if;
 return v_quote;
end;
$$;
create function public.place_test_order(p_drawing_key text,p_purpose_id uuid,p_agreement_id uuid,p_expected_amount_cents integer,p_expected_agreement_text text,p_accepted boolean,p_customer_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_company uuid;v_before jsonb;v_result jsonb;v_reference text:=nullif(trim(p_customer_reference),'');
begin
 if length(p_customer_reference)>100 or p_customer_reference ~ '[[:cntrl:]]' then raise exception 'CUSTOMER_REFERENCE_INVALID'; end if;
 if p_accepted is distinct from true then raise exception 'CONSENT_REQUIRED'; end if;
 select company_id into v_company from public.profiles where id=auth.uid() and status='approved' for share;
 if v_company is null then raise exception 'APPROVAL_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||p_drawing_key||':'||p_purpose_id::text,0));
 v_before:=public.test_order_quote(p_drawing_key,p_purpose_id);
 v_result:=private.place_test_order_without_reference(p_drawing_key,p_purpose_id,p_agreement_id,p_expected_amount_cents,p_expected_agreement_text,p_accepted);
 if not coalesce((v_before->>'owned')::boolean,false) then
  update public.orders set customer_reference=v_reference where id=(v_result->>'order_id')::uuid;
 end if;
 return public.test_order_quote(p_drawing_key,p_purpose_id);
end;
$$;
-- Backwards-compatible six-argument entry point; no overloaded default ambiguity.
create function public.place_test_order(p_drawing_key text,p_purpose_id uuid,p_agreement_id uuid,p_expected_amount_cents integer,p_expected_agreement_text text,p_accepted boolean) returns jsonb
language sql security definer set search_path='' as $$
 select public.place_test_order(p_drawing_key,p_purpose_id,p_agreement_id,p_expected_amount_cents,p_expected_agreement_text,p_accepted,null);
$$;
revoke all on function public.test_order_quote(text,uuid),public.place_test_order(text,uuid,uuid,integer,text,boolean),public.place_test_order(text,uuid,uuid,integer,text,boolean,text) from public,anon;
grant execute on function public.test_order_quote(text,uuid),public.place_test_order(text,uuid,uuid,integer,text,boolean),public.place_test_order(text,uuid,uuid,integer,text,boolean,text) to authenticated;
create or replace function public.server_moneybird_invoice_trial(p_actor_id uuid,p_order_id uuid,p_administration_id text,p_owner uuid,p_action text,p_data jsonb default '{}') returns jsonb
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
   if v_plan is null or v_plan->>'order_id' is distinct from p_order_id::text or v_plan->>'administration_id' is distinct from p_administration_id or v_plan->>'company_id' is distinct from v_source->'company'->>'id' or v_plan->>'contact_id' is distinct from v_source->'link'->>'contact_id' or (v_plan->>'link_revision')::integer is distinct from (v_source->'link'->>'revision')::integer or v_source->'link'->>'administration_id' is distinct from p_administration_id or v_plan->>'recipient_email' is distinct from v_source->>'buyer_email' or (v_plan->>'amount_cents')::bigint is distinct from v_amount or (v_plan->>'vat_cents')::bigint is distinct from v_vat or (v_plan->>'total_cents')::bigint is distinct from v_total or v_total is null or v_total<=0 or coalesce(v_plan->>'internal_reference',v_plan->>'reference') is distinct from 'BRB-PROEF-'||p_order_id::text then raise exception 'INVOICE_PLAN'; end if;
   if v_job.order_id is null then
    insert into private.moneybird_invoice_trials(administration_id,order_id,company_id,created_by,reference,request_snapshot,status)
    values(p_administration_id,p_order_id,(v_source->'company'->>'id')::uuid,p_actor_id,coalesce(v_plan->>'internal_reference',v_plan->>'reference'),v_plan,'prepared') returning * into v_job;
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
commit;
