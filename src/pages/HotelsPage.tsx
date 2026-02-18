
import { useState, useEffect, useMemo } from 'react';
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

  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Carrega bookings que tenham hotéis
  useEffect(() => {
    const loadBookings = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('id, name, hotels, passengers')
          .order('created_at', { ascending: false });
        if (!error && data) {
          setBookings(data);
        } else {
          setBookings([]);
        }
      } catch (err) {
        setBookings([]);
      } finally {
        setLoading(false);
      }
    };
    loadBookings();
  }, []);

  // Flatten bookings.hotels para lista de hospedagens
  const hotels = useMemo(() => {
    const out: any[] = [];
    for (const b of bookings) {
      if (Array.isArray(b.hotels)) {
        for (const h of b.hotels) {
          out.push({
            ...h,
            booking_id: b.id,
            // Nome do hóspede: preferir fullName, depois main_passenger_name, depois vazio
            guest_name: b.passengers?.[0]?.fullName ?? b.main_passenger_name ?? '',
            // Nome do hotel: preferir name, depois hotelName, depois vazio
            hotel_display_name: h.name ?? h.hotelName ?? '',
            check_in: h.checkIn ?? '',
            check_out: h.checkOut ?? '',
          });
        }
      }
    }
    return out;
  }, [bookings]);

  // Excluir hospedagem = remover do array hotels e atualizar booking
  const handleDeleteHotel = async (bookingId: string, hotelIndex: number) => {
    setLoading(true);
    try {
      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;
      const newHotels = [...(booking.hotels || [])];
      newHotels.splice(hotelIndex, 1);
      await supabase.from('bookings').update({ hotels: newHotels }).eq('id', bookingId);
      setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, hotels: newHotels } : b));
    } finally {
      setLoading(false);
    }
  };

  // Filtro de busca
  const filteredHotels = useMemo(() => hotels.filter(hotel => {
    return (
      (hotel.confirmationCode || hotel.confirm || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.hotel_display_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.guest_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }), [hotels, searchTerm]);

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

            {filteredHotels.length > 0 ? (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Hospedagens</h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredHotels.map((hotel, idx) => (
                    <HotelCard
                      key={hotel.booking_id + '-' + idx}
                      hotel={hotel as any}
                      onDelete={isAdmin ? () => handleDeleteHotel(hotel.booking_id, idx) : undefined}
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
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
