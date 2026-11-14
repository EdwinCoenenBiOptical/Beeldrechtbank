-- Explicitly recover an externally deleted, never-sent draft. No order/right deletion.
begin;
create table private.moneybird_invoice_trial_recoveries (
 id uuid primary key default gen_random_uuid(),administration_id text not null,
 order_id uuid not null references public.orders(id),actor_id uuid not null references auth.users(id),
 removed_invoice_id text not null,previous_snapshot jsonb not null,previous_request jsonb not null,
 confirmed_deleted_unissued boolean not null check(confirmed_deleted_unissued),recovered_at timestamptz not null default now()
);
alter table private.moneybird_invoice_trial_recoveries enable row level security;
revoke all on private.moneybird_invoice_trial_recoveries from public,anon,authenticated;
create function public.server_recover_deleted_invoice_trial(p_actor_id uuid,p_order_id uuid,p_administration_id text,p_owner uuid,p_invoice_id text,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_source jsonb;v_job private.moneybird_invoice_trials%rowtype;
begin
 -- Recheck the explicitly assigned administrator and ownership of the selected testorder.
 v_source:=private.moneybird_trial_source(p_actor_id,p_order_id);
 if p_confirmed is distinct from true or p_owner is null or coalesce(p_invoice_id,'') !~ '^[0-9]{1,40}$' then raise exception 'INVOICE_RECOVERY_NOT_ALLOWED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('moneybird-invoice-trial:'||p_administration_id,0));
 select * into v_job from private.moneybird_invoice_trials where administration_id=p_administration_id for update;
 if v_job.order_id is null or v_job.order_id<>p_order_id or v_job.invoice_id is distinct from p_invoice_id then raise exception 'INVOICE_RECOVERY_CHANGED'; end if;
 if v_job.lease_owner is distinct from p_owner or v_job.lease_until is null or v_job.lease_until<=now() then raise exception 'INVOICE_BUSY'; end if;
 -- Conservative fence: even a historic send attempt requires manual investigation.
 if v_job.sent_at is not null or v_job.send_unresolved or v_job.status not in ('draft','blocked')
 or v_job.invoice_snapshot->>'state' is distinct from 'draft' or nullif(v_job.invoice_snapshot->>'sent_at','') is not null
 or exists(select 1 from private.moneybird_invoice_trial_events e where e.administration_id=p_administration_id and e.order_id=p_order_id and e.action='sending') then raise exception 'INVOICE_RECOVERY_NOT_ALLOWED'; end if;
 if not exists(select 1 from private.moneybird_connection where encrypted_tokens is not null and not reconnect_required and administration_id=p_administration_id) then raise exception 'CONNECTION_REQUIRED'; end if;
 insert into private.moneybird_invoice_trial_recoveries(administration_id,order_id,actor_id,removed_invoice_id,previous_snapshot,previous_request,confirmed_deleted_unissued)
 values(p_administration_id,p_order_id,p_actor_id,p_invoice_id,v_job.invoice_snapshot,v_job.request_snapshot,true);
 update private.moneybird_invoice_trials set status='prepared',invoice_id=null,invoice_snapshot=null,review_hash=null,last_error=null,updated_at=now()
 where administration_id=p_administration_id returning * into v_job;
 insert into private.moneybird_invoice_trial_events(administration_id,order_id,actor_id,action,status,invoice_id)
 values(p_administration_id,p_order_id,p_actor_id,'recover_deleted_draft','prepared',p_invoice_id);
 return to_jsonb(v_job)-'lease_owner'-'lease_until';
end;
$$;
revoke all on function public.server_recover_deleted_invoice_trial(uuid,uuid,text,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.server_recover_deleted_invoice_trial(uuid,uuid,text,uuid,text,boolean) to service_role;
commit;
