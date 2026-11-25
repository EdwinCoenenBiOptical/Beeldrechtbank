-- Catalogue staging and atomic publication. No orders, rights or invoices are changed.
-- Depends on 001/004/007. Originals and their locations remain private.
begin;
create table private.catalogue_batches (
 id uuid primary key, source_hash text not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), published_at timestamptz,
 status text not null default 'draft' check(status in ('draft','published')),
 summary jsonb not null, warnings jsonb not null
);
create table private.catalogue_entries (
 batch_id uuid not null references private.catalogue_batches(id),id uuid not null,
 image_key text not null,source_path text not null check(source_path like 'Rechtbanktekeningen/Beelden/%'),
 metadata jsonb not null, publish_requested boolean not null, download_allowed boolean not null,
 preview_key text,preview_fingerprint text,preview_status text not null default 'pending' check(preview_status in ('pending','ready','failed')),
 last_error text,prepared_at timestamptz,primary key(batch_id,id),unique(batch_id,image_key)
);
create table private.catalogue_settings(singleton boolean primary key default true check(singleton),active_batch uuid references private.catalogue_batches(id));
insert into private.catalogue_settings(singleton) values(true);
alter table private.catalogue_batches enable row level security;
alter table private.catalogue_entries enable row level security;
alter table private.catalogue_settings enable row level security;
revoke all on private.catalogue_batches,private.catalogue_entries,private.catalogue_settings from public,anon,authenticated;
-- Private bucket: the public route serves only previews from the active publication.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('catalogue-previews','catalogue-previews',false,1048576,array['image/jpeg']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function public.server_catalogue(p_actor_id uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.catalogue_batches%rowtype;e private.catalogue_entries%rowtype;v_id uuid:=(p_data->>'batch_id')::uuid;v_rows jsonb;v_counts jsonb;v_page integer:=coalesce((p_data->>'page')::integer,1);v_active uuid;v_preview text;
begin
 -- Preview lookup is service-only but does not require a signed-in viewer.
 if p_action='public_preview' then
  select q.preview_key into v_preview from private.catalogue_entries q join private.catalogue_settings s on s.active_batch=q.batch_id
  where s.singleton and q.id=(p_data->>'id')::uuid and q.publish_requested and q.preview_status='ready' and q.preview_fingerprint=p_data->>'version';
  return jsonb_build_object('key',v_preview);
 end if;
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED'; end if;
 if p_action='stage' then
  if v_id is null or jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') not between 1 and 5000 or p_data->>'hash' !~ '^[a-f0-9]{64}$' then raise exception 'CATALOGUE_INVALID'; end if;
  insert into private.catalogue_batches(id,source_hash,created_by,summary,warnings)
   values(v_id,p_data->>'hash',p_actor_id,p_data->'summary',p_data->'warnings') on conflict(id) do nothing;
  select * into b from private.catalogue_batches where id=v_id for update;
  if b.source_hash is distinct from p_data->>'hash' or b.created_by<>p_actor_id then raise exception 'CATALOGUE_CHANGED'; end if;
  if exists(select 1 from private.catalogue_entries where batch_id=v_id) then return jsonb_build_object('batch_id',v_id);end if;
  insert into private.catalogue_entries(batch_id,id,image_key,source_path,metadata,publish_requested,download_allowed)
   select v_id,(r->>'id')::uuid,r->>'key',r->>'source_path',r-array['source_path','publish','download'],(r->>'publish')::boolean,(r->>'download')::boolean from jsonb_array_elements(p_data->'rows') r;
  return jsonb_build_object('batch_id',v_id);
 elsif p_action='status' then
  if v_page not between 1 and 1000 then raise exception 'CATALOGUE_INVALID'; end if;
  if v_id is null then select * into b from private.catalogue_batches order by created_at desc,id limit 1;else select * into b from private.catalogue_batches where id=v_id;end if;
  select active_batch into v_active from private.catalogue_settings where singleton;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.image_key),'[]') into v_rows from (
   select id,image_key,metadata->>'title' title,source_path,publish_requested,download_allowed,preview_status,last_error,preview_fingerprint from private.catalogue_entries where batch_id=b.id order by image_key limit 50 offset (v_page-1)*50
  ) q;
  select jsonb_build_object('total',count(*),'requested',count(*) filter(where publish_requested),'ready',count(*) filter(where publish_requested and preview_status='ready'),'failed',count(*) filter(where publish_requested and preview_status='failed'),'pending',count(*) filter(where publish_requested and preview_status<>'ready')) into v_counts from private.catalogue_entries where batch_id=b.id;
  return jsonb_build_object('batch',to_jsonb(b),'active_batch',v_active,'entries',v_rows,'counts',v_counts,'page',v_page);
 elsif p_action in ('entry','ready','failed') then
  select * into b from private.catalogue_batches where id=v_id for update;
  if b.id is null then raise exception 'CATALOGUE_MISSING';end if;
  select * into e from private.catalogue_entries where batch_id=v_id and id=(p_data->>'id')::uuid for update;
  if e.id is null or not e.publish_requested then raise exception 'CATALOGUE_MISSING';end if;
  if p_action='entry' then return to_jsonb(e)||jsonb_build_object('batch_status',b.status);end if;
  if b.status<>'draft' then raise exception 'CATALOGUE_CHANGED';end if;
  if p_action='ready' then
   if p_data->>'fingerprint' is null or p_data->>'key' is null or p_data->>'fingerprint' !~ '^[a-f0-9]{64}$' or p_data->>'key' is distinct from v_id::text||'/'||e.id::text||'-'||(p_data->>'fingerprint')||'.jpg' then raise exception 'CATALOGUE_INVALID';end if;
   update private.catalogue_entries set preview_status='ready',preview_key=p_data->>'key',preview_fingerprint=p_data->>'fingerprint',last_error=null,prepared_at=now() where batch_id=v_id and id=e.id;
  else
   update private.catalogue_entries set preview_status='failed',last_error=left(p_data->>'error_code',100) where batch_id=v_id and id=e.id and preview_status<>'ready';
  end if;
  return jsonb_build_object('ok',true);
 elsif p_action='draft_preview' then
  select preview_key into v_preview from private.catalogue_entries where batch_id=v_id and id=(p_data->>'id')::uuid and preview_status='ready';
  return jsonb_build_object('key',v_preview);
 elsif p_action='next' then
  select coalesce(jsonb_agg(id order by image_key),'[]') into v_rows from (select id,image_key from private.catalogue_entries where batch_id=v_id and publish_requested and preview_status='pending' order by image_key limit 5) q;
  return v_rows;
 elsif p_action='publish' then
  select * into b from private.catalogue_batches where id=v_id for update;
  if b.id is null then raise exception 'CATALOGUE_MISSING';end if;
  if b.status<>'draft' then raise exception 'CATALOGUE_CHANGED';end if;
  if not exists(select 1 from private.catalogue_entries where batch_id=v_id and publish_requested) or exists(select 1 from private.catalogue_entries where batch_id=v_id and publish_requested and (preview_status<>'ready' or preview_key is null)) then raise exception 'CATALOGUE_NOT_READY';end if;
  update private.catalogue_settings set active_batch=v_id where singleton;
  update private.catalogue_batches set status='published',published_at=now() where id=v_id;
  return jsonb_build_object('published',true);
 end if;
 raise exception 'CATALOGUE_INVALID';
end;
$$;
revoke all on function public.server_catalogue(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_catalogue(uuid,text,jsonb) to service_role;
create function public.catalogue_public_rows() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('active',s.active_batch is not null,'drawings',coalesce((select jsonb_agg(
  jsonb_build_object('id',q.id,'key',q.image_key,'title',q.metadata->>'title','date',q.metadata->>'date','court',q.metadata->>'court',
   'caseName',q.metadata->>'caseName','suspect',array_to_string(array(select jsonb_array_elements_text(q.metadata->'suspects')),' | '),
   'lawyer',array_to_string(array(select jsonb_array_elements_text(q.metadata->'lawyers')),' | '),'keywords',q.metadata->'keywords',
   'crimeDate',q.metadata->>'crimeDate','crimePlace',q.metadata->>'crimePlace','crimeType',q.metadata->>'crimeType','crimeDescription',q.metadata->>'crimeDescription',
   'downloadAllowed',q.download_allowed,'preview','/api/catalogue/previews/'||q.id::text||'?v='||q.preview_fingerprint,'isSample',false)
  order by q.metadata->>'date' desc,q.image_key) from private.catalogue_entries q where q.batch_id=s.active_batch and q.publish_requested and q.preview_status='ready'),'[]')) from private.catalogue_settings s where singleton;
$$;
revoke all on function public.catalogue_public_rows() from public;
grant execute on function public.catalogue_public_rows() to anon,authenticated,service_role;
commit;
