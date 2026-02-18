
import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HotelCard } from '@/components/cards/HotelCard';
import { HotelForm } from '@/components/forms/HotelForm';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export default function HotelsPage() {
  const { isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [hotelBookings, setHotelBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Carrega bookings que tenham hotels preenchido
  useEffect(() => {
    const loadHotels = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('id, name, hotels, passengers')
          .order('created_at', { ascending: false });
        if (!error && data) {
          // Filtra bookings que tenham pelo menos 1 hotel
          const hotelsList = data
            .filter((b: any) => Array.isArray(b.hotels) && b.hotels.length > 0)
            .map((b: any) => {
              const hotel = b.hotels[0];
              return {
                id: b.id,
                hotel_name: hotel?.hotelName || hotel?.name || '-',
                confirmation_code: hotel?.confirmationCode || hotel?.confirm || '-',
                check_in: hotel?.checkIn || '-',
                check_out: hotel?.checkOut || '-',
                city: hotel?.city || '-',
                guests: b.passengers?.[0]?.name || '-',
                total: Number(hotel?.total ?? 0),
                locator: hotel?.confirmationCode || '-',
                guestName: b.passengers?.[0]?.name || '-',
                booking_id: b.id,
              };
            });
          setHotelBookings(hotelsList);
        } else {
          setHotelBookings([]);
        }
      } catch (err) {
        setHotelBookings([]);
      } finally {
        setLoading(false);
      }
    };
    loadHotels();
  }, []);

  // Excluir hospedagem = limpar campo hotels do booking
  const handleDeleteHotel = async (bookingId: string) => {
    setLoading(true);
    try {
      await supabase.from('bookings').update({ hotels: [] }).eq('id', bookingId);
      setHotelBookings((prev) => prev.filter((h) => h.booking_id !== bookingId));
    } finally {
      setLoading(false);
    }
  };

  const filteredHotelBookings = hotelBookings.filter(hotel => {
    return (
      (hotel.confirmation_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.hotel_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.guestName || '').toLowerCase().includes(searchTerm.toLowerCase())
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

            {filteredHotelBookings.length > 0 ? (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Hospedagens</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredHotelBookings.map((hotel) => (
                    <HotelCard
                      key={hotel.id}
                      hotel={hotel as any}
                      onDelete={isAdmin ? () => handleDeleteHotel(hotel.booking_id) : undefined}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  {searchTerm
                    ? 'Nenhuma hospedagem encontrada com os filtros aplicados.'
                    : 'Nenhuma hospedagem cadastrada ainda.'}
                </p>
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
