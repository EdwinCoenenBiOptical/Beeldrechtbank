-- Private approved-member portal and catalogue checkout. No automatic invoicing.
-- Run after 001..018 (006 is optional). Existing test orders and invoice trial remain unchanged.
begin;
create function public.portal_approved() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.status='approved' and p.company_id is not null and u.email_confirmed_at is not null);
$$;
revoke all on function public.portal_approved() from public,anon;
grant execute on function public.portal_approved() to authenticated;
-- Remove the anonymous metadata RPC, including direct Supabase access.
revoke all on function public.catalogue_public_rows() from public,anon,authenticated,service_role;
alter function public.catalogue_public_rows() set schema private;
create function public.catalogue_public_rows() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.portal_approved() then raise exception 'APPROVAL_REQUIRED';end if;
 return private.catalogue_public_rows();
end;
$$;
revoke all on function public.catalogue_public_rows() from public,anon;
grant execute on function public.catalogue_public_rows() to authenticated;
-- Real catalogue orders are distinguishable from the historical test-only records.
alter table public.orders drop constraint orders_is_test_check;
alter table public.catalogue_drawings drop constraint catalogue_drawings_is_test_check;
alter table public.download_events drop constraint download_events_file_name_check;
alter table public.download_events drop constraint download_events_byte_count_check;
alter table public.download_events drop constraint download_events_is_test_check;
alter table public.download_events add check(length(file_name) between 1 and 512 and file_name !~ '[[:cntrl:]]');
alter table public.download_events add check(byte_count between 1 and 2147483647);
create table private.catalogue_order_sources(
 order_item_id uuid primary key references public.order_items(id),image_id uuid not null,
 source_path text not null,image_key text not null,created_at timestamptz not null default now()
);
alter table private.catalogue_order_sources enable row level security;
revoke all on private.catalogue_order_sources from public,anon,authenticated;
create function public.catalogue_order_quote(p_image_id uuid,p_purpose_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_company uuid;v_name text;v_image private.catalogue_entries%rowtype;v_quote jsonb;
 v_price public.company_prices%rowtype;v_purpose public.usage_purposes%rowtype;
 v_settings public.checkout_settings%rowtype;v_body text;v_text text;v_vat bigint;
begin
 if not public.portal_approved() then raise exception 'APPROVAL_REQUIRED';end if;
 select p.company_id,c.name into v_company,v_name from public.profiles p join public.companies c on c.id=p.company_id where p.id=auth.uid() and p.status='approved' for share of p,c;
 perform 1 from private.catalogue_settings where singleton for share;
 select q.* into v_image from private.catalogue_entries q join private.catalogue_settings s on s.active_batch=q.batch_id
 where q.id=p_image_id and q.publish_requested and q.preview_status='ready' for share of q;
 if v_image.id is null then raise exception 'DRAWING_UNAVAILABLE';end if;
 if not v_image.download_allowed then raise exception 'DOWNLOAD_NOT_ALLOWED';end if;
 -- An explicitly non-Dutch linked billing contact cannot buy domestic downloads.
 if exists(select 1 from private.moneybird_company_links where company_id=v_company and coalesce(contact_snapshot->>'country','NL')<>'NL') then raise exception 'DOMESTIC_ONLY';end if;
 select jsonb_build_object('owned',true,'is_test',false,'order_id',o.id,'order_number',o.order_number,
 'drawing_title',i.drawing_title_snapshot,'purpose_name',i.purpose_name_snapshot,'company_name',o.company_name_snapshot,
 'amount_cents',i.amount_cents,'vat_percent',i.vat_percent,'vat_cents',i.vat_cents,'total_cents',i.total_cents,'currency',i.currency,
 'agreement_id',i.agreement_id,'agreement_text',i.agreement_text_snapshot,'customer_reference',o.customer_reference,
 'can_download',true,'image_id',p_image_id)
 into v_quote from public.order_items i join public.orders o on o.id=i.order_id join public.usage_rights r on r.order_item_id=i.id
 join private.catalogue_order_sources src on src.order_item_id=i.id and src.image_id=p_image_id
 where i.company_id=v_company and i.drawing_id=p_image_id and i.purpose_id=p_purpose_id and not o.is_test;
 if v_quote is not null then return v_quote;end if;
 select * into v_purpose from public.usage_purposes where id=p_purpose_id and active for share;
 if v_purpose.id is null then raise exception 'PURPOSE_UNAVAILABLE';end if;
 select * into v_price from public.company_prices where company_id=v_company and purpose_id=p_purpose_id
 and valid_from<=current_date and (valid_until is null or valid_until>current_date) for share;
 if v_price.id is null then raise exception 'PRICE_UNAVAILABLE';end if;
 select * into strict v_settings from public.checkout_settings where singleton for share;
 select body into strict v_body from public.agreement_versions where id=v_settings.agreement_id for share;
 v_text:=replace(replace(replace(v_body,'[bedrijf]',v_name),'[doel]',v_purpose.name),'[bedrag]',replace(to_char(v_price.amount_cents::numeric/100,'FM9999999990.00'),'.',','));
 v_vat:=(v_price.amount_cents::bigint*21+50)/100;
 return jsonb_build_object('owned',false,'is_test',false,'company_name',v_name,'drawing_title',v_image.metadata->>'title',
 'purpose_name',v_purpose.name,'amount_cents',v_price.amount_cents,'vat_percent',21,'vat_cents',v_vat,'total_cents',v_price.amount_cents::bigint+v_vat,
 'currency',v_price.currency,'agreement_id',v_settings.agreement_id,'agreement_text',v_text,'can_download',false,'image_id',p_image_id);
end;
$$;
create function public.place_catalogue_order(p_image_id uuid,p_purpose_id uuid,p_agreement_id uuid,p_expected_amount_cents integer,p_expected_agreement_text text,p_accepted boolean,p_customer_reference text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_company uuid;v_quote jsonb;v_order uuid;v_item uuid;v_image private.catalogue_entries%rowtype;
begin
 if p_accepted is distinct from true then raise exception 'CONSENT_REQUIRED';end if;
 if length(p_customer_reference)>100 or p_customer_reference ~ '[[:cntrl:]]' then raise exception 'CUSTOMER_REFERENCE_INVALID';end if;
 if not public.portal_approved() then raise exception 'APPROVAL_REQUIRED';end if;
 select company_id into v_company from public.profiles where id=auth.uid() for share;
 perform pg_advisory_xact_lock(hashtextextended(v_company::text||':catalogue:'||p_image_id::text||':'||p_purpose_id::text,0));
 v_quote:=public.catalogue_order_quote(p_image_id,p_purpose_id);
 if (v_quote->>'owned')::boolean then return v_quote;end if;
 if (v_quote->>'agreement_id')::uuid is distinct from p_agreement_id or (v_quote->>'amount_cents')::integer is distinct from p_expected_amount_cents or v_quote->>'agreement_text' is distinct from p_expected_agreement_text then raise exception 'QUOTE_CHANGED';end if;
 select q.* into strict v_image from private.catalogue_entries q join private.catalogue_settings s on s.active_batch=q.batch_id where q.id=p_image_id;
 -- Keep legacy test RPCs from accepting these real catalogue rows.
 insert into public.catalogue_drawings(id,catalogue_key,title,published,is_test)
 values(p_image_id,'CAT-'||p_image_id::text,v_image.metadata->>'title',false,false) on conflict(id) do nothing;
 insert into public.orders(company_id,user_id,company_name_snapshot,is_test,customer_reference)
 values(v_company,auth.uid(),v_quote->>'company_name',false,nullif(trim(p_customer_reference),'')) returning id into v_order;
 insert into public.order_items(order_id,company_id,drawing_id,purpose_id,drawing_title_snapshot,purpose_name_snapshot,
 amount_cents,vat_percent,vat_cents,total_cents,currency,agreement_id,agreement_text_snapshot)
 values(v_order,v_company,p_image_id,p_purpose_id,v_quote->>'drawing_title',v_quote->>'purpose_name',(v_quote->>'amount_cents')::integer,21,
 (v_quote->>'vat_cents')::bigint,(v_quote->>'total_cents')::bigint,v_quote->>'currency',p_agreement_id,p_expected_agreement_text) returning id into v_item;
 insert into public.usage_rights(order_item_id) values(v_item);
 insert into private.catalogue_order_sources(order_item_id,image_id,source_path,image_key) values(v_item,p_image_id,v_image.source_path,v_image.image_key);
 return public.catalogue_order_quote(p_image_id,p_purpose_id);
end;
$$;
create function private.catalogue_download_right(p_user_id uuid,p_image_id uuid,p_purpose_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_right jsonb;
begin
 select jsonb_build_object('order_item_id',i.id,'source_path',src.source_path,'file_name',src.image_key)
 into v_right from public.profiles p join auth.users u on u.id=p.id
 join public.order_items i on i.company_id=p.company_id and i.drawing_id=p_image_id and i.purpose_id=p_purpose_id
 join public.orders o on o.id=i.order_id and not o.is_test
 join public.usage_rights r on r.order_item_id=i.id join private.catalogue_order_sources src on src.order_item_id=i.id
 join private.catalogue_settings s on s.singleton join private.catalogue_entries e on e.batch_id=s.active_batch and e.id=p_image_id
 where p.id=p_user_id and p.status='approved' and u.email_confirmed_at is not null and e.publish_requested and e.download_allowed and e.preview_status='ready' and not exists(select 1 from private.moneybird_company_links l where l.company_id=p.company_id and coalesce(l.contact_snapshot->>'country','NL')<>'NL');
 if v_right is null then raise exception 'DOWNLOAD_RIGHT_REQUIRED';end if;
 return v_right;
end;
$$;
revoke all on function private.catalogue_download_right(uuid,uuid,uuid) from public,anon,authenticated;
create function public.server_catalogue_download(p_user_id uuid,p_image_id uuid,p_purpose_id uuid,p_order_item_id uuid default null,p_byte_count integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_right jsonb;v_event uuid;
begin
 -- Serialize account reassignment and recheck entitlement immediately before issuing delivery.
 perform 1 from public.profiles where id=p_user_id for update;
 v_right:=private.catalogue_download_right(p_user_id,p_image_id,p_purpose_id);
 if p_order_item_id is not null then
  if p_order_item_id is distinct from (v_right->>'order_item_id')::uuid then raise exception 'DOWNLOAD_RIGHT_CHANGED';end if;
  insert into public.download_events(user_id,order_item_id,file_name,byte_count,is_test)
  values(p_user_id,p_order_item_id,v_right->>'file_name',p_byte_count,false) returning id into v_event;
 end if;
 return v_right||jsonb_build_object('event_id',v_event);
end;
$$;
revoke all on function public.catalogue_order_quote(uuid,uuid),public.place_catalogue_order(uuid,uuid,uuid,integer,text,boolean,text) from public,anon;
grant execute on function public.catalogue_order_quote(uuid,uuid),public.place_catalogue_order(uuid,uuid,uuid,integer,text,boolean,text) to authenticated;
revoke all on function public.server_catalogue_download(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.server_catalogue_download(uuid,uuid,uuid,uuid,integer) to service_role;
commit;
