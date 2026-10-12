-- Execute after 002_prices.sql. Amounts are in euro cents, EXCLUDING VAT.
-- This assigns prices to a company by its unique KvK, never to an individual.
begin;
do $$ begin
 if not exists(select 1 from public.companies where kvk_number='77328949') then
  raise exception 'Company with KvK 77328949 is missing. Approve and link the company first.';
 end if;
 if (select count(*) from public.usage_purposes where name in ('Online','Print','TV') and active) <> 3 then
  raise exception 'The three active usage purposes are required.';
 end if;
end $$;
insert into public.company_prices(company_id,purpose_id,amount_cents,currency,valid_from)
select c.id,u.id,v.amount_cents,'EUR',current_date
from public.companies c
cross join (values ('Online',10000),('Print',17500),('TV',25000)) v(name,amount_cents)
join public.usage_purposes u on u.name=v.name
where c.kvk_number='77328949'
on conflict(company_id,purpose_id,valid_from) do update set amount_cents=excluded.amount_cents
returning company_id,purpose_id,amount_cents,currency,valid_from;
commit;
-- Run once; rerunning on the same date is safe. A different date cannot overlap
-- existing tariffs. Close the previous interval before introducing a new one.
