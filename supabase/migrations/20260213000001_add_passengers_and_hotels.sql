-- Add passengers column to bookings table to store extracted passenger data
ALTER TABLE public.bookings 
ADD COLUMN passengers JSONB DEFAULT '[]'::jsonb;

-- Create hotel_bookings table for persisting hotel reservations
CREATE TABLE public.hotel_bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  hotel_name TEXT NOT NULL,
  city TEXT,
  address TEXT,
  confirmation_code TEXT,
  check_in DATE,
  check_out DATE,
  guests TEXT, -- JSON string with array of guest names, or comma-separated
  total DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.hotel_bookings ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage all hotel_bookings"
ON public.hotel_bookings
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can view hotel_bookings for their companies
CREATE POLICY "Users can view company hotel_bookings"
ON public.hotel_bookings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.company_users cu
    WHERE cu.company_id = hotel_bookings.company_id
    AND cu.user_id = auth.uid()
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_hotel_bookings_updated_at
BEFORE UPDATE ON public.hotel_bookings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
