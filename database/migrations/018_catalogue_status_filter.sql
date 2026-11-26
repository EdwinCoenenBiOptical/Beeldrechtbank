-- Read-only status filtering across the complete import, with filtered pagination.
-- Run once after 017. No preview, source, publication or order is changed.
begin;
create function public.server_catalogue_page(p_actor_id uuid,p_batch_id uuid,p_status text default 'all',p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_total bigint;v_page integer;v_rows jsonb;
begin
 if not exists(select 1 from private.onedrive_admins a join public.profiles p on p.id=a.user_id join auth.users u on u.id=p.id
  where p.id=p_actor_id and p.status='approved' and u.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED';end if;
 if p_status is null or p_status not in ('all','failed','pending','ready') or p_page is null or p_page not between 1 and 1000 then raise exception 'CATALOGUE_INVALID';end if;
 if not exists(select 1 from private.catalogue_batches where id=p_batch_id) then raise exception 'CATALOGUE_MISSING';end if;
 select count(*) into v_total from private.catalogue_entries where batch_id=p_batch_id and (p_status='all' or preview_status=p_status);
 v_page:=least(p_page,greatest(1,ceil(v_total::numeric/50)::integer));
 select coalesce(jsonb_agg(to_jsonb(q) order by q.image_key),'[]') into v_rows from (
  select id,image_key,metadata->>'title' title,source_path,publish_requested,download_allowed,preview_status,last_error,preview_fingerprint
  from private.catalogue_entries where batch_id=p_batch_id and (p_status='all' or preview_status=p_status)
  order by image_key limit 50 offset (v_page-1)*50
 ) q;
 return jsonb_build_object('entries',v_rows,'page',v_page,'filtered_total',v_total,'filter',p_status);
end;
$$;
revoke all on function public.server_catalogue_page(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.server_catalogue_page(uuid,uuid,text,integer) to service_role;
commit;
