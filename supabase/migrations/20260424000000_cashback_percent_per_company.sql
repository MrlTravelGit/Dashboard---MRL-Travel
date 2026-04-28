-- =============================================================
-- Migration: cashback_percent por empresa
-- Arquivo: 20260424000000_cashback_percent_per_company.sql
-- NÃO reexecuta migrações antigas. Apenas adiciona/altera.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Coluna cashback_percent em companies
--    default 1 (= 1%), NOT NULL, check 0..100
-- -------------------------------------------------------------
alter table public.companies
  add column if not exists cashback_percent numeric not null default 1
    constraint companies_cashback_percent_check
      check (cashback_percent >= 0 and cashback_percent <= 100);

-- -------------------------------------------------------------
-- 2. Coluna cashback_percent_used em cashback_entries
--    Congela o percentual usado no momento do cálculo
-- -------------------------------------------------------------
alter table public.cashback_entries
  add column if not exists cashback_percent_used numeric not null default 1;

-- Retroativamente deduz o percentual dos registros já existentes
-- (cashback_amount / paid_amount * 100), fallback = 1
update public.cashback_entries
set cashback_percent_used = case
  when paid_amount > 0
  then round((cashback_amount / paid_amount) * 100, 4)
  else 1
end
where cashback_percent_used = 1;

-- -------------------------------------------------------------
-- 3. Garante UNIQUE(booking_id) — já existe na migration original,
--    mas recria de forma segura caso não exista
-- -------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cashback_entries'::regclass
      and contype = 'u'
      and conname = 'cashback_entries_booking_id_key'
  ) then
    alter table public.cashback_entries
      add constraint cashback_entries_booking_id_key unique (booking_id);
  end if;
end;
$$;

-- -------------------------------------------------------------
-- 4. Substitui a função do trigger para usar o percentual da empresa
--    (mantém a mesma assinatura → sem precisar recriar triggers)
-- -------------------------------------------------------------
create or replace function public.upsert_cashback_for_booking()
returns trigger
language plpgsql
security definer
as $$
declare
  v_paid    numeric;
  v_pct     numeric;
  v_cash    numeric;
begin
  -- Bypass RLS (já era assim na versão original)
  perform set_config('row_security', 'off', true);

  v_paid := coalesce(new.total_paid, 0);

  -- Busca o percentual da empresa; fallback = 1 se não encontrado
  select coalesce(cashback_percent, 1)
    into v_pct
    from public.companies
   where id = new.company_id;

  v_pct  := coalesce(v_pct, 1);
  v_cash := round(v_paid * v_pct / 100, 2);

  insert into public.cashback_entries
    (company_id, booking_id, booking_created_at, paid_amount, cashback_percent_used, cashback_amount)
  values
    (new.company_id, new.id, new.created_at, v_paid, v_pct, v_cash)
  on conflict (booking_id) do update
    set company_id            = excluded.company_id,
        booking_created_at    = excluded.booking_created_at,
        paid_amount           = excluded.paid_amount,
        cashback_percent_used = excluded.cashback_percent_used,
        cashback_amount       = excluded.cashback_amount,
        updated_at            = now();

  return new;
end;
$$;

-- Os triggers (trg_cashback_after_insert e trg_cashback_after_update_total_paid)
-- já existem da migration anterior e apontam para a mesma função.
-- Não é necessário recriar.

-- -------------------------------------------------------------
-- 5. Funções auxiliares de RLS (SECURITY DEFINER, sem recursão)
-- -------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_company_member_v2(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_users
    where company_id = p_company_id and user_id = auth.uid()
  );
$$;
grant execute on function public.is_company_member_v2(uuid) to authenticated;

-- -------------------------------------------------------------
-- 6. RLS: company_users
-- -------------------------------------------------------------
alter table public.company_users enable row level security;

drop policy if exists "company_users_select_own"   on public.company_users;
drop policy if exists "company_users_select_admin"  on public.company_users;

create policy "company_users_select_own" on public.company_users
  for select to authenticated using (user_id = auth.uid());

create policy "company_users_select_admin" on public.company_users
  for select to authenticated using (public.is_admin());

-- -------------------------------------------------------------
-- 7. RLS: companies  (SELECT para membro; ALL para admin)
-- -------------------------------------------------------------
alter table public.companies enable row level security;

drop policy if exists "companies_select_member" on public.companies;
drop policy if exists "companies_select_admin"  on public.companies;
drop policy if exists "companies_all_admin"     on public.companies;

create policy "companies_select_member" on public.companies
  for select to authenticated using (public.is_company_member_v2(id));

create policy "companies_all_admin" on public.companies
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -------------------------------------------------------------
-- 8. RLS: bookings
-- -------------------------------------------------------------
alter table public.bookings enable row level security;

drop policy if exists "bookings_select_member" on public.bookings;
drop policy if exists "bookings_all_admin"     on public.bookings;

create policy "bookings_select_member" on public.bookings
  for select to authenticated using (public.is_company_member_v2(company_id));

create policy "bookings_all_admin" on public.bookings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -------------------------------------------------------------
-- 9. RLS: cashback_entries
--    (substitui políticas da migration original que usam has_role)
-- -------------------------------------------------------------
drop policy if exists "Admins can manage cashback entries" on public.cashback_entries;
drop policy if exists "Users can view company cashback"    on public.cashback_entries;

create policy "cashback_select_member" on public.cashback_entries
  for select to authenticated using (public.is_company_member_v2(company_id));

create policy "cashback_all_admin" on public.cashback_entries
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -------------------------------------------------------------
-- 10. GRANTs mínimos
-- -------------------------------------------------------------
grant select on public.company_users    to authenticated;
grant select on public.companies        to authenticated;
grant select on public.bookings         to authenticated;
grant select on public.cashback_entries to authenticated;
