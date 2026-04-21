-- Migration: garantir colunas jsonb e main_passenger_name em bookings
alter table public.bookings
  add column if not exists passengers jsonb not null default '[]'::jsonb,
  add column if not exists hotels jsonb not null default '[]'::jsonb,
  add column if not exists cars jsonb not null default '[]'::jsonb,
  add column if not exists main_passenger_name text;
