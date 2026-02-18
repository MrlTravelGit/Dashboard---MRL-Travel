-- Migration: Criação da tabela hotel_bookings para hospedagens
create table if not exists public.hotel_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  hotel_name text not null,
  check_in date null,
  check_out date null,
  reservation_code text null,
  guest_name text null,
  created_at timestamptz not null default now()
);

create index if not exists hotel_bookings_booking_id_idx
  on public.hotel_bookings(booking_id);

create index if not exists hotel_bookings_company_id_idx
  on public.hotel_bookings(company_id);

create index if not exists hotel_bookings_created_at_idx
  on public.hotel_bookings(created_at desc);

-- RLS: Permitir acesso apenas para usuários autenticados da mesma empresa
alter table public.hotel_bookings enable row level security;

create policy "Allow company users read/write hotel_bookings" on public.hotel_bookings
  for all
  using (auth.uid() is not null and company_id in (select company_id from public.company_users where user_id = auth.uid()));
