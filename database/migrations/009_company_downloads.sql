-- Shared test download rights; OneDrive credentials remain server-only.
begin;
create function private.company_download_right(p_user_id uuid,p_purpose_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_right jsonb;
begin
 select jsonb_build_object('order_item_id',i.id,'drawing_title',i.drawing_title_snapshot,'purpose_name',i.purpose_name_snapshot)
 into v_right from public.order_items i join public.orders o on o.id=i.order_id
 join public.usage_rights r on r.order_item_id=i.id join public.catalogue_drawings d on d.id=i.drawing_id
 join public.profiles p on p.company_id=i.company_id and p.id=p_user_id
 join auth.users u on u.id=p.id
 where i.purpose_id=p_purpose_id and d.catalogue_key='NVH-0001' and d.published and d.is_test
 and o.is_test and p.status='approved' and u.email_confirmed_at is not null;
 if v_right is null then raise exception 'TEST_RIGHT_REQUIRED'; end if;
 return v_right;
end;
$$;
revoke all on function private.company_download_right(uuid,uuid) from public,anon,authenticated;
create or replace function public.test_download_right(p_purpose_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select private.company_download_right(auth.uid(),p_purpose_id);
$$;
-- Customers cannot fabricate offered-file history directly.
revoke all on function public.record_test_download(uuid,integer) from authenticated;
create function public.server_record_test_download(p_user_id uuid,p_purpose_id uuid,p_order_item_id uuid,p_byte_count integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_right jsonb;v_id uuid;
begin
 -- Serialize with company assignment; recheck the right after fetching bytes.
 perform 1 from public.profiles where id=p_user_id for update;
 v_right:=private.company_download_right(p_user_id,p_purpose_id);
 if (v_right->>'order_item_id')::uuid is distinct from p_order_item_id then raise exception 'TEST_RIGHT_CHANGED'; end if;
 insert into public.download_events(user_id,order_item_id,file_name,byte_count)
 values(p_user_id,p_order_item_id,'NVH-001.jpg',p_byte_count) returning id into v_id;
 return v_id;
end;
$$;
create function public.server_read_onedrive_connection() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('encrypted_tokens',encrypted_tokens,'metadata',metadata,'revision',revision,'connected_at',connected_at)
 from private.onedrive_connection where singleton;
$$;
create function public.server_save_onedrive_connection(p_encrypted_tokens text,p_metadata jsonb,p_expected_revision integer) returns integer
language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
 if p_encrypted_tokens is null or length(p_encrypted_tokens) not between 1 and 60000 or p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'INVALID_CONNECTION'; end if;
 update private.onedrive_connection set encrypted_tokens=p_encrypted_tokens,metadata=p_metadata,revision=revision+1
 where singleton and revision=p_expected_revision returning revision into v_revision;
 if v_revision is null then raise exception 'CONNECTION_CHANGED'; end if;
 return v_revision;
end;
$$;
revoke all on function public.server_record_test_download(uuid,uuid,uuid,integer),public.server_read_onedrive_connection(),public.server_save_onedrive_connection(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.server_record_test_download(uuid,uuid,uuid,integer),public.server_read_onedrive_connection(),public.server_save_onedrive_connection(text,jsonb,integer) to service_role;
commit;
