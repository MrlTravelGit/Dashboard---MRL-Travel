import { useState, useEffect } from 'react';
import { useBooking } from '@/contexts/BookingContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HotelCard } from '@/components/cards/HotelCard';
import { HotelForm } from '@/components/forms/HotelForm';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface HotelBooking {
  id: string;
  hotel_name: string;
  confirmation_code?: string;
  check_in?: string;
  check_out?: string;
  city?: string;
  guests?: string;
  total?: number;
  locator?: string; // for compatibility with HotelCard
  guestName?: string; // for compatibility with HotelCard
  booking_id?: string;
}

export default function HotelsPage() {
  const { hotels, deleteHotel } = useBooking();
  const { isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [hotelBookings, setHotelBookings] = useState<HotelBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHotelBookings = async () => {
      setLoading(true);
      try {
        // Busca hotel_bookings e faz join lógico com bookings para pegar passageiro principal
        const { data: hotelData, error: hotelError } = await (supabase as any)
          .from('hotel_bookings')
          .select('*')
          .order('created_at', { ascending: false });

        if (!hotelError && hotelData && hotelData.length > 0) {
          // Busca bookings relacionados para pegar passengers
          const bookingIds = hotelData.map((h: any) => h.booking_id).filter(Boolean);
          let bookingMap: Record<string, any> = {};
          if (bookingIds.length > 0) {
            const { data: bookingsData, error: bookingsError } = await (supabase as any)
              .from('bookings')
              .select('id, passengers')
              .in('id', bookingIds);
            if (!bookingsError && bookingsData) {
              bookingMap = Object.fromEntries(bookingsData.map((b: any) => [b.id, b]));
            }
          }
          // Normaliza e injeta guestName do passageiro principal
          const normalized: HotelBooking[] = hotelData.map((h: any) => {
            let guestName = h.guests;
            if ((!guestName || guestName === '-') && h.booking_id && bookingMap[h.booking_id]) {
              const passengers = bookingMap[h.booking_id]?.passengers || [];
              guestName = passengers[0]?.name || passengers[0]?.fullName || 'Não informado';
            }
            return {
              id: h.id,
              hotel_name: h.hotel_name,
              confirmation_code: h.confirmation_code,
              check_in: h.check_in,
              check_out: h.check_out,
              city: h.city,
              guests: h.guests,
              total: h.total,
              locator: h.confirmation_code,
              guestName,
              booking_id: h.booking_id,
            };
          });
          setHotelBookings(normalized);
        } else {
          setHotelBookings([]);
        }
      } catch (err) {
        console.error('Error loading hotel bookings (expected if migration not applied):', err);
        setHotelBookings([]);
      } finally {
        setLoading(false);
      }
    };
    loadHotelBookings();
  }, []);

  const filteredHotels = hotels.filter(hotel => {
    return (
      (hotel.locator || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.hotelName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.guestName || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const filteredHotelBookings = hotelBookings.filter(hotel => {
    return (
      (hotel.confirmation_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.hotel_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.guests || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Hospedagens</h2>
            <p className="text-muted-foreground">Gerencie todas as reservas de hotéis</p>
          </div>
          {isAdmin ? <HotelForm /> : null}
        </div>

        {/* Filters */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por localizador, hotel ou hóspede..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Loading State */}
        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground">Carregando hospedagens...</p>
          </div>
        ) : (
          <>
            {/* Hotel Bookings from hotel_bookings table */}
            {filteredHotelBookings.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Hospedagens Cadastradas</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredHotelBookings.map((hotel) => (
                    <HotelCard
                      key={hotel.id}
                      hotel={hotel as any}
                      onDelete={undefined} // hotel_bookings don't have delete from HotelCard directly
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Hotels from bookings table (JSONB) */}
            {filteredHotels.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Hospedagens Extraídas</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredHotels.map((hotel) => (
                    <HotelCard
                      key={hotel.id}
                      hotel={hotel}
                      onDelete={isAdmin ? deleteHotel : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {filteredHotelBookings.length === 0 && filteredHotels.length === 0 && (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  {searchTerm 
                    ? 'Nenhuma hospedagem encontrada com os filtros aplicados.' 
                    : 'Nenhuma hospedagem cadastrada ainda.'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
