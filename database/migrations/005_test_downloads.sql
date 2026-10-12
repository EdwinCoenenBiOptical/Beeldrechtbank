-- Only designated administrators can test-download the ONE linked original.
begin;
create table public.download_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 order_item_id uuid not null references public.order_items(id), offered_at timestamptz not null default now(),
 file_name text not null check(file_name='NVH-001.jpg'), byte_count integer not null check(byte_count between 1 and 3145728),
 is_test boolean not null default true check(is_test), status text not null default 'offered' check(status='offered')
);
alter table public.download_events enable row level security;
revoke all on public.download_events from public,anon,authenticated;
grant select on public.download_events to authenticated;
create policy "read own company download events" on public.download_events for select to authenticated using(
 exists(select 1 from public.order_items i where i.id=download_events.order_item_id)
);
create function public.test_download_right(p_purpose_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_right jsonb;
begin
 if not public.is_onedrive_admin() then raise exception 'ADMIN_REQUIRED'; end if;
 select jsonb_build_object('order_item_id',i.id,'drawing_title',i.drawing_title_snapshot,'purpose_name',i.purpose_name_snapshot)
 into v_right from public.order_items i join public.orders o on o.id=i.order_id
 join public.usage_rights r on r.order_item_id=i.id
 join public.catalogue_drawings d on d.id=i.drawing_id
 join public.profiles p on p.company_id=i.company_id and p.id=auth.uid()
 where i.purpose_id=p_purpose_id and d.catalogue_key='NVH-0001' and d.published and d.is_test
 and o.is_test and p.status='approved';
 if v_right is null then raise exception 'TEST_RIGHT_REQUIRED'; end if;
 return v_right;
end;
$$;
create function public.record_test_download(p_purpose_id uuid,p_byte_count integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_right jsonb;v_id uuid;
begin
 v_right:=public.test_download_right(p_purpose_id);
 insert into public.download_events(user_id,order_item_id,file_name,byte_count)
 values(auth.uid(),(v_right->>'order_item_id')::uuid,'NVH-001.jpg',p_byte_count) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.test_download_right(uuid),public.record_test_download(uuid,integer) from public,anon;
grant execute on function public.test_download_right(uuid),public.record_test_download(uuid,integer) to authenticated;
commit;
