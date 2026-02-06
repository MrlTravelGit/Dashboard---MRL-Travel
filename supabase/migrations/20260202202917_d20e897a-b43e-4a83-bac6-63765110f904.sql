-- Add payment_deadline_days column to companies table
ALTER TABLE public.companies 
ADD COLUMN payment_deadline_days integer NOT NULL DEFAULT 30;