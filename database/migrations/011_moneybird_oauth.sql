-- Server-only OAuth state, encrypted credentials and refresh leases.
begin;
create table private.moneybird_connection (
 singleton boolean primary key default true check(singleton),
 encrypted_tokens text,administration_id text,administration_name text,scope text,
 revision integer not null default 0 check(revision>=0),connected_by uuid references auth.users(id),connected_at timestamptz,
 reconnect_required boolean not null default false,refresh_owner uuid,refresh_until timestamptz,
 check(encrypted_tokens is null or length(encrypted_tokens) between 1 and 60000)
);
insert into private.moneybird_connection(singleton) values(true);
create table private.moneybird_oauth_states (
 state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'),actor_id uuid not null references auth.users(id),
 verifier text not null check(length(verifier) between 43 and 128),expected_revision integer not null,
 administration_id text not null,scope text not null,expires_at timestamptz not null default(now()+interval '10 minutes'),
 consumed_at timestamptz,completed_at timestamptz
);
create table private.moneybird_connection_events (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
 action text not null check(action in ('connected','disconnected','refreshed')),created_at timestamptz not null default now(),
 administration_id text,revision integer not null
);
alter table private.moneybird_connection_events enable row level security;
revoke all on private.moneybird_connection_events from public,anon,authenticated;
alter table private.moneybird_connection enable row level security;
alter table private.moneybird_oauth_states enable row level security;
revoke all on private.moneybird_connection,private.moneybird_oauth_states from public,anon,authenticated;
create function public.server_moneybird_oauth(p_actor_id uuid,p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row private.moneybird_connection%rowtype;v_state private.moneybird_oauth_states%rowtype;
begin
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED'; end if;
 if p_action='read' then
  select * into v_row from private.moneybird_connection;return to_jsonb(v_row);
 elsif p_action='start' then
  delete from private.moneybird_oauth_states where expires_at<now()-interval '1 day';
  if coalesce(p_data->>'administration_id','') !~ '^[0-9]{1,40}$' or coalesce(length(p_data->>'scope'),0) not between 1 and 200 then raise exception 'INVALID_STATE'; end if;
  select * into v_row from private.moneybird_connection;
  insert into private.moneybird_oauth_states(state_hash,actor_id,verifier,expected_revision,administration_id,scope)
  values(p_data->>'state_hash',p_actor_id,p_data->>'verifier',v_row.revision,p_data->>'administration_id',p_data->>'scope');
  return jsonb_build_object('started',true);
 elsif p_action='consume' then
  update private.moneybird_oauth_states set consumed_at=now()
  where state_hash=p_data->>'state_hash' and actor_id=p_actor_id and consumed_at is null and expires_at>now() returning * into v_state;
  if v_state.state_hash is null then raise exception 'INVALID_STATE'; end if;
  return to_jsonb(v_state);
 elsif p_action='connect' then
  select * into v_state from private.moneybird_oauth_states where state_hash=p_data->>'state_hash' and actor_id=p_actor_id for update;
  if v_state.state_hash is null or v_state.consumed_at is null or v_state.completed_at is not null or v_state.expires_at<now() then raise exception 'INVALID_STATE'; end if;
  if p_data->>'administration_id' is distinct from v_state.administration_id or p_data->>'scope' is distinct from v_state.scope or coalesce(length(p_data->>'encrypted_tokens'),0) not between 1 and 60000 then raise exception 'INVALID_CONNECTION'; end if;
  update private.moneybird_connection set encrypted_tokens=p_data->>'encrypted_tokens',administration_id=v_state.administration_id,
  administration_name=left(p_data->>'administration_name',200),scope=v_state.scope,revision=revision+1,connected_by=p_actor_id,connected_at=now(),reconnect_required=false,refresh_owner=null,refresh_until=null
  where revision=v_state.expected_revision returning * into v_row;
  if v_row.singleton is null then raise exception 'CONNECTION_CHANGED'; end if;
  update private.moneybird_oauth_states set completed_at=now() where state_hash=v_state.state_hash;
  insert into private.moneybird_connection_events(actor_id,action,administration_id,revision) values(p_actor_id,'connected',v_row.administration_id,v_row.revision);
  return jsonb_build_object('connected',true);
 elsif p_action='claim' then
  update private.moneybird_connection set refresh_owner=(p_data->>'owner')::uuid,refresh_until=now()+interval '2 minutes'
  where revision=(p_data->>'revision')::integer and encrypted_tokens is not null and not reconnect_required and (refresh_until is null or refresh_until<now()) returning * into v_row;
  return case when v_row.singleton is null then null else to_jsonb(v_row) end;
 elsif p_action='refresh' then
  if coalesce(length(p_data->>'encrypted_tokens'),0) not between 1 and 60000 then raise exception 'INVALID_CONNECTION'; end if;
  update private.moneybird_connection set encrypted_tokens=p_data->>'encrypted_tokens',revision=revision+1,refresh_owner=null,refresh_until=null
  where revision=(p_data->>'revision')::integer and refresh_owner=(p_data->>'owner')::uuid and encrypted_tokens is not null returning * into v_row;
  if v_row.singleton is null then raise exception 'CONNECTION_CHANGED'; end if;
  insert into private.moneybird_connection_events(actor_id,action,administration_id,revision) values(p_actor_id,'refreshed',v_row.administration_id,v_row.revision);
  return jsonb_build_object('refreshed',true);
 elsif p_action='release' then
  update private.moneybird_connection set refresh_owner=null,refresh_until=null,reconnect_required=coalesce((p_data->>'reconnect')::boolean,false)
  where revision=(p_data->>'revision')::integer and refresh_owner=(p_data->>'owner')::uuid;
  return jsonb_build_object('released',true);
 elsif p_action='disconnect' then
  -- Keep a revision tombstone so a pending callback cannot resurrect a disconnected connection.
  update private.moneybird_connection set encrypted_tokens=null,administration_id=null,administration_name=null,scope=null,revision=revision+1,connected_by=null,connected_at=null,reconnect_required=false,refresh_owner=null,refresh_until=null returning * into v_row;
  insert into private.moneybird_connection_events(actor_id,action,revision) values(p_actor_id,'disconnected',v_row.revision);
  return jsonb_build_object('disconnected',true);
 end if;
 raise exception 'INVALID_ACTION';
end;
$$;
revoke all on function public.server_moneybird_oauth(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_moneybird_oauth(uuid,text,jsonb) to service_role;
commit;
