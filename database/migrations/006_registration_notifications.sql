-- Queue new signups. Sending is separate, so a mail outage cannot undo a signup.
-- No notifications are backfilled for existing users.
begin;
create table public.registration_notifications (
 id uuid primary key default gen_random_uuid(), profile_id uuid unique not null references public.profiles(id) on delete cascade,
 full_name text not null, email text not null, company_name text not null, kvk_number text not null,
 created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','processing','retry','sent','failed')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lock_token uuid, lease_until timestamptz, sent_at timestamptz, provider_id text, last_error_code text
);
alter table public.registration_notifications enable row level security;
revoke all on public.registration_notifications from public,anon,authenticated;
create function public.queue_registration_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_email text;
begin
 select email into v_email from auth.users where id=new.id;
 if v_email is not null then
  insert into public.registration_notifications(profile_id,full_name,email,company_name,kvk_number)
  values(new.id,new.full_name,v_email,new.requested_company_name,new.requested_kvk)
  on conflict(profile_id) do nothing;
 end if;
 return new;
end;
$$;
revoke all on function public.queue_registration_notification() from public,anon,authenticated;
create trigger on_profile_registered after insert on public.profiles for each row execute function public.queue_registration_notification();
create function public.claim_registration_notifications(p_limit integer default 10) returns setof public.registration_notifications
language sql security definer set search_path='' as $$
 with exhausted as (
 update public.registration_notifications set status='failed',lock_token=null,lease_until=null,last_error_code='WORKER_LEASE_EXPIRED'
 where status='processing' and attempts>=10 and lease_until<now() returning id
 )
 update public.registration_notifications n
 set status='processing',attempts=n.attempts+1,lock_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 where n.id in (
 select id from public.registration_notifications
 where attempts<10 and ((status in ('pending','retry') and next_attempt_at<=now()) or (status='processing' and lease_until<now()))
 order by created_at,id limit greatest(1,least(p_limit,10)) for update skip locked
 ) returning n.*;
$$;
create function public.finish_registration_notification(p_id uuid,p_lock_token uuid,p_provider_id text,p_error_code text) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 update public.registration_notifications set
 status=case when p_provider_id is not null then 'sent' when attempts>=10 then 'failed' else 'retry' end,
 sent_at=case when p_provider_id is not null then now() else null end,
 provider_id=left(p_provider_id,200),last_error_code=left(p_error_code,100),
 next_attempt_at=now()+interval '5 minutes',lock_token=null,lease_until=null
 where id=p_id and lock_token=p_lock_token and status='processing';
 get diagnostics v_count=row_count;return v_count=1;
end;
$$;
revoke all on function public.claim_registration_notifications(integer),public.finish_registration_notification(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_registration_notifications(integer),public.finish_registration_notification(uuid,uuid,text,text) to service_role;
commit;
