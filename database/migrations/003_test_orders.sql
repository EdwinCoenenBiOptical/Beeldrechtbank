-- First purchase-flow trial. All orders are explicitly TEST orders.
-- No invoice or original download is generated. Run once after migrations 001/002.
begin;
create table public.catalogue_drawings (
 id uuid primary key default gen_random_uuid(), catalogue_key text unique not null,
 title text not null, published boolean not null default true,
 is_test boolean not null default true check(is_test)
);
insert into public.catalogue_drawings(catalogue_key,title)
select 'NVH-'||lpad(n::text,4,'0'),title from unnest(array[
 'De zitting in beeld','Een moment in de rechtszaal','Portret tijdens de zitting','Luisteren naar het pleidooi','Aan het woord','De behandeling van de zaak','Blik op de rechtszaal','Voor de rechtbank','Tijdens het verhoor','De zitting hervat','Aan de verdediging','Een laatste verklaring'
]) with ordinality as titles(title,n);
create table public.agreement_versions (
 id uuid primary key default gen_random_uuid(), body text not null,
 created_at timestamptz not null default now()
);
create table public.checkout_settings (
 singleton boolean primary key default true check(singleton),
 agreement_id uuid not null references public.agreement_versions(id),
 vat_percent integer not null default 21 check(vat_percent=21),
 is_test boolean not null default true check(is_test)
);
with version as (
 insert into public.agreement_versions(body) values(
 'Ik bestel deze tekening namens [bedrijf] voor herhaald gebruik binnen [doel], tegen € [bedrag] exclusief btw. Ik begrijp dat hiervoor een factuur wordt gestuurd. Gebruik binnen een ander gebruiksdoel vereist een aparte bestelling.'
 ) returning id
) insert into public.checkout_settings(agreement_id) select id from version;
create table public.orders (
 id uuid primary key default gen_random_uuid(), order_number bigint generated always as identity unique,
 company_id uuid not null references public.companies(id), user_id uuid not null references public.profiles(id),
 company_name_snapshot text not null, accepted_at timestamptz not null default now(),
 is_test boolean not null default true check(is_test), unique(id,company_id)
);
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null,
 company_id uuid not null, drawing_id uuid not null references public.catalogue_drawings(id),
 purpose_id uuid not null references public.usage_purposes(id),
 drawing_title_snapshot text not null, purpose_name_snapshot text not null,
 amount_cents integer not null check(amount_cents>=0), vat_percent integer not null check(vat_percent=21),
 vat_cents bigint not null, total_cents bigint not null, currency text not null check(currency='EUR'),
 agreement_id uuid not null references public.agreement_versions(id), agreement_text_snapshot text not null,
 foreign key(order_id,company_id) references public.orders(id,company_id),
 unique(company_id,drawing_id,purpose_id),
 check(vat_cents=(amount_cents::bigint*vat_percent+50)/100),
 check(total_cents=amount_cents::bigint+vat_cents)
);
-- A separate right refers to the original purchased line; repeat downloads never create purchases.
create table public.usage_rights (
 id uuid primary key default gen_random_uuid(), order_item_id uuid unique not null references public.order_items(id),
 granted_at timestamptz not null default now()
);
alter table public.catalogue_drawings enable row level security;
alter table public.agreement_versions enable row level security;
alter table public.checkout_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.usage_rights enable row level security;
revoke all on public.catalogue_drawings,public.agreement_versions,public.checkout_settings,public.orders,public.order_items,public.usage_rights from anon,authenticated;
grant select on public.orders,public.order_items,public.usage_rights to authenticated;
create policy "read approved company orders" on public.orders for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved' and p.company_id=orders.company_id)
);
create policy "read approved company items" on public.order_items for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='approved' and p.company_id=order_items.company_id)
);
create policy "read approved company rights" on public.usage_rights for select to authenticated using (
 exists(select 1 from public.order_items i where i.id=usage_rights.order_item_id)
);
create function public.test_order_quote(p_drawing_key text,p_purpose_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_company uuid; v_company_name text; v_drawing public.catalogue_drawings%rowtype;
 v_purpose public.usage_purposes%rowtype; v_price public.company_prices%rowtype;
 v_settings public.checkout_settings%rowtype; v_body text; v_text text; v_existing jsonb;
 v_vat bigint;
begin
 select company_id into v_company from public.profiles where id=v_user and status='approved' for share;
 if v_company is null or not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null) then
  raise exception 'APPROVAL_REQUIRED';
 end if;
 select name into strict v_company_name from public.companies where id=v_company for share;
 select * into v_drawing from public.catalogue_drawings where catalogue_key=p_drawing_key and published for share;
 if v_drawing.id is null then raise exception 'DRAWING_UNAVAILABLE'; end if;
 -- Existing rights keep their original price/text even if current tariffs or names change.
 select jsonb_build_object('owned',true,'is_test',o.is_test,'order_id',o.id,'order_number',o.order_number,
  'drawing_title',i.drawing_title_snapshot,'purpose_name',i.purpose_name_snapshot,'company_name',o.company_name_snapshot,
  'amount_cents',i.amount_cents,'vat_percent',i.vat_percent,'vat_cents',i.vat_cents,'total_cents',i.total_cents,
  'agreement_id',i.agreement_id,'agreement_text',i.agreement_text_snapshot,'currency',i.currency)
 into v_existing from public.order_items i join public.orders o on o.id=i.order_id
 join public.usage_rights r on r.order_item_id=i.id
 where i.company_id=v_company and i.drawing_id=v_drawing.id and i.purpose_id=p_purpose_id;
 if v_existing is not null then return v_existing; end if;
 select * into v_purpose from public.usage_purposes where id=p_purpose_id and active for share;
 if v_purpose.id is null then raise exception 'PURPOSE_UNAVAILABLE'; end if;
 select * into v_price from public.company_prices where company_id=v_company and purpose_id=p_purpose_id
 and valid_from<=current_date and (valid_until is null or valid_until>current_date) for share;
 if v_price.id is null then raise exception 'PRICE_UNAVAILABLE'; end if;
 select * into strict v_settings from public.checkout_settings where singleton for share;
 select body into strict v_body from public.agreement_versions where id=v_settings.agreement_id for share;
 v_text:=replace(replace(replace(v_body,'[bedrijf]',v_company_name),'[doel]',v_purpose.name),
 '[bedrag]',replace(to_char(v_price.amount_cents::numeric/100,'FM9999999990.00'),'.',','));
 v_vat:=(v_price.amount_cents::bigint*v_settings.vat_percent+50)/100;
 return jsonb_build_object('owned',false,'is_test',true,'company_name',v_company_name,'drawing_title',v_drawing.title,
 'purpose_name',v_purpose.name,'amount_cents',v_price.amount_cents,'currency',v_price.currency,
 'vat_percent',v_settings.vat_percent,'vat_cents',v_vat,'total_cents',v_price.amount_cents::bigint+v_vat,
 'agreement_id',v_settings.agreement_id,'agreement_text',v_text);
end;
$$;
create function public.place_test_order(p_drawing_key text,p_purpose_id uuid,p_agreement_id uuid,p_expected_amount_cents integer,p_expected_agreement_text text,p_accepted boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_quote jsonb; v_company uuid; v_drawing uuid; v_order uuid; v_item uuid;
begin
 if p_accepted is distinct from true then raise exception 'CONSENT_REQUIRED'; end if;
 select company_id into v_company from public.profiles where id=auth.uid() and status='approved' for share;
 if v_company is null then raise exception 'APPROVAL_REQUIRED'; end if;
 -- Serializes simultaneous confirmations by colleagues for the same company and image/purpose.
 perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||p_drawing_key||':'||p_purpose_id::text,0));
 v_quote:=public.test_order_quote(p_drawing_key,p_purpose_id);
 if (v_quote->>'owned')::boolean then return v_quote; end if;
 if (v_quote->>'agreement_id')::uuid is distinct from p_agreement_id
 or (v_quote->>'amount_cents')::integer is distinct from p_expected_amount_cents
 or (v_quote->>'agreement_text') is distinct from p_expected_agreement_text then raise exception 'QUOTE_CHANGED'; end if;
 select id into strict v_drawing from public.catalogue_drawings where catalogue_key=p_drawing_key;
 insert into public.orders(company_id,user_id,company_name_snapshot) values(v_company,auth.uid(),v_quote->>'company_name') returning id into v_order;
 insert into public.order_items(order_id,company_id,drawing_id,purpose_id,drawing_title_snapshot,purpose_name_snapshot,
 amount_cents,vat_percent,vat_cents,total_cents,currency,agreement_id,agreement_text_snapshot)
 values(v_order,v_company,v_drawing,p_purpose_id,v_quote->>'drawing_title',v_quote->>'purpose_name',
 (v_quote->>'amount_cents')::integer,(v_quote->>'vat_percent')::integer,(v_quote->>'vat_cents')::bigint,
 (v_quote->>'total_cents')::bigint,v_quote->>'currency',p_agreement_id,v_quote->>'agreement_text') returning id into v_item;
 insert into public.usage_rights(order_item_id) values(v_item);
 return public.test_order_quote(p_drawing_key,p_purpose_id);
end;
$$;
revoke all on function public.test_order_quote(text,uuid),public.place_test_order(text,uuid,uuid,integer,text,boolean) from public,anon;
grant execute on function public.test_order_quote(text,uuid),public.place_test_order(text,uuid,uuid,integer,text,boolean) to authenticated;
commit;
