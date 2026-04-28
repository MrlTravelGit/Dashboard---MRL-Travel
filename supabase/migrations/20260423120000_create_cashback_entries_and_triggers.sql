-- Create cashback_entries table and automatic triggers based on bookings.total_paid

create table if not exists public.cashback_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  booking_created_at timestamptz,
  paid_amount numeric not null default 0,
  cashback_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create index if not exists cashback_entries_company_created_at
  on public.cashback_entries (company_id, created_at desc);

-- updated_at trigger
drop trigger if exists update_cashback_entries_updated_at on public.cashback_entries;
create trigger update_cashback_entries_updated_at
before update on public.cashback_entries
for each row execute function public.update_updated_at_column();

-- Enable RLS
alter table public.cashback_entries enable row level security;

-- Policies: follow existing auth model (has_role + company_users)

drop policy if exists "Admins can manage cashback entries" on public.cashback_entries;
create policy "Admins can manage cashback entries"
on public.cashback_entries
for all
using (has_role(auth.uid(), 'admin'::app_role));

-- Users can view cashback for their companies

drop policy if exists "Users can view company cashback" on public.cashback_entries;
create policy "Users can view company cashback"
on public.cashback_entries
for select
using (
  exists (
    select 1 from public.company_users cu
    where cu.company_id = cashback_entries.company_id
      and cu.user_id = auth.uid()
  )
);

-- Function to upsert cashback row (bypass RLS when called from triggers)
create or replace function public.upsert_cashback_for_booking()
returns trigger
language plpgsql
security definer
as $$
declare
  v_paid numeric;
  v_cash numeric;
begin
  -- Ensure trigger can write even with RLS
  perform set_config('row_security', 'off', true);

  v_paid := coalesce(new.total_paid, 0);
  v_cash := round(v_paid * 0.01, 2);

  insert into public.cashback_entries (company_id, booking_id, booking_created_at, paid_amount, cashback_amount)
  values (new.company_id, new.id, new.created_at, v_paid, v_cash)
  on conflict (booking_id) do update
    set company_id = excluded.company_id,
        booking_created_at = excluded.booking_created_at,
        paid_amount = excluded.paid_amount,
        cashback_amount = excluded.cashback_amount,
        updated_at = now();

  return new;
end;
$$;

-- Triggers on bookings

drop trigger if exists trg_cashback_after_insert on public.bookings;
create trigger trg_cashback_after_insert
after insert on public.bookings
for each row
when (new.total_paid is not null)
execute function public.upsert_cashback_for_booking();

-- Fire when total_paid changes

drop trigger if exists trg_cashback_after_update_total_paid on public.bookings;
create trigger trg_cashback_after_update_total_paid
after update of total_paid on public.bookings
for each row
when (new.total_paid is distinct from old.total_paid)
execute function public.upsert_cashback_for_booking();
