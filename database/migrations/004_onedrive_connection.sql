-- OneDrive connection management only; no original downloads enabled yet.
begin;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.onedrive_admins(user_id uuid primary key references auth.users(id));
-- Edwin's already verified account. Do not assign administration through signup metadata.
insert into private.onedrive_admins(user_id) values ('ab74ba00-4f8e-4ee0-8479-bee145211f16');
create table private.onedrive_connection (
 singleton boolean primary key default true check(singleton),
 encrypted_tokens text not null, metadata jsonb not null,
 revision integer not null default 1, connected_at timestamptz not null default now()
);
alter table private.onedrive_admins enable row level security;
alter table private.onedrive_connection enable row level security;
revoke all on private.onedrive_admins,private.onedrive_connection from public,anon,authenticated;
create function public.is_onedrive_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id
 join auth.users u on u.id=a.user_id where a.user_id=auth.uid() and p.status='approved' and u.email_confirmed_at is not null);
$$;
create function public.read_onedrive_connection() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not public.is_onedrive_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select jsonb_build_object('encrypted_tokens',encrypted_tokens,'metadata',metadata,'revision',revision,'connected_at',connected_at)
 into v_result from private.onedrive_connection where singleton;
 return v_result;
end;
$$;
create function public.save_onedrive_connection(p_encrypted_tokens text,p_metadata jsonb,p_expected_revision integer) returns integer
language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
 if not public.is_onedrive_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 if length(p_encrypted_tokens) not between 1 and 60000 or jsonb_typeof(p_metadata) <> 'object' then raise exception 'INVALID_CONNECTION'; end if;
 if p_expected_revision=0 then
  insert into private.onedrive_connection(encrypted_tokens,metadata) values(p_encrypted_tokens,p_metadata) returning revision into v_revision;
 else
  update private.onedrive_connection set encrypted_tokens=p_encrypted_tokens,metadata=p_metadata,revision=revision+1
  where singleton and revision=p_expected_revision returning revision into v_revision;
 end if;
 if v_revision is null then raise exception 'CONNECTION_CHANGED'; end if;
 return v_revision;
end;
$$;
revoke all on function public.is_onedrive_admin(),public.read_onedrive_connection(),public.save_onedrive_connection(text,jsonb,integer) from public,anon;
grant execute on function public.is_onedrive_admin(),public.read_onedrive_connection(),public.save_onedrive_connection(text,jsonb,integer) to authenticated;
commit;
