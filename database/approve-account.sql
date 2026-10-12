-- Run manually in Supabase SQL Editor after checking the company and applicant.
-- Replace the UUID below with the applicant's ID from Authentication > Users.
-- This file is NOT executable as supplied; it never automatically approves by email.
begin;
with company as (
 insert into public.companies(name,kvk_number)
 values ('Edwin Coenen','77328949')
 on conflict(kvk_number) do update set kvk_number=excluded.kvk_number
 returning id
)
update public.profiles p
set company_id=company.id,status='approved',reviewed_at=now()
from company
where p.id='REPLACE_WITH_VERIFIED_USER_UUID'::uuid
 and p.requested_kvk='77328949'
 and exists(select 1 from auth.users u where u.id=p.id and u.email_confirmed_at is not null)
returning p.id,p.full_name,p.status,p.company_id;
-- Confirm exactly one row is returned. Zero rows means approval did not happen.
commit;
-- To reject a checked application, use its UUID:
-- update public.profiles set status='rejected',reviewed_at=now() where id='VERIFIED_UUID';
