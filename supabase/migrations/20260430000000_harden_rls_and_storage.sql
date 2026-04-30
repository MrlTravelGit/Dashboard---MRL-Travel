-- Harden policies that were too broad in earlier migrations.

drop policy if exists "Users can view companies" on public.companies;

drop policy if exists "companies_select_member" on public.companies;
drop policy if exists "companies_all_admin" on public.companies;

create policy "companies_select_member" on public.companies
  for select to authenticated
  using (public.is_company_member_v2(id));

create policy "companies_all_admin" on public.companies
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Authenticated users can upload company logos" on storage.objects;
drop policy if exists "Authenticated users can update company logos" on storage.objects;
drop policy if exists "Authenticated users can delete company logos" on storage.objects;

create policy "Admins can upload company logos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and public.is_admin()
  );

create policy "Admins can update company logos" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'company-logos'
    and public.is_admin()
  )
  with check (
    bucket_id = 'company-logos'
    and public.is_admin()
  );

create policy "Admins can delete company logos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and public.is_admin()
  );
