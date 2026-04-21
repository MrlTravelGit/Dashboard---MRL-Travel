-- MIGRATION: Ensure passengers column exists in bookings and is always JSONB
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS passengers JSONB NOT NULL DEFAULT '[]'::jsonb;

-- MIGRATION: Ensure booking_id exists in hotel_bookings and is UUID
ALTER TABLE public.hotel_bookings
ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE;

-- MIGRATION: Ensure guests column in hotel_bookings is TEXT (for storing main guest name)
ALTER TABLE public.hotel_bookings
ADD COLUMN IF NOT EXISTS guests TEXT;

-- Optional: reload PostgREST schema cache (run in SQL Editor if needed)
-- select pg_notify('pgrst', 'reload schema');

-- Documentação: Execute este arquivo no Supabase SQL Editor se necessário para garantir que as colunas estejam presentes e corretas.
