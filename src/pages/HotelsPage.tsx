import { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HotelCard } from '@/components/cards/HotelCard';
import { HotelForm } from '@/components/forms/HotelForm';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { getHotelStatus } from '@/utils/statusUtils';

export default function HotelsPage() {
  const { isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'completed'>('all');

  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadBookings = async () => {
      setLoading(true);
      try {
        const selectCandidates = [
          'id, name, hotels, passengers, main_passenger_name, created_at',
          'id, name, hotels, passengers, created_at',
        ];

        let lastError: any = null;
        let data: any[] | null = null;

        for (const selectStr of selectCandidates) {
          const { data: d, error } = await supabase
            .from('bookings')
            .select(selectStr as any)
            .order('created_at', { ascending: false });

          if (!error && d) {
            data = d as any[];
            lastError = null;
            break;
          }

          lastError = error;

          const msg = (error?.message || '').toLowerCase();
          const isMissingMainPassenger =
            msg.includes('main_passenger_name') ||
            (msg.includes('column') && msg.includes('does not exist') && msg.includes('main_passenger_name'));

          if (isMissingMainPassenger) continue;
          break;
        }

        if (!cancelled) {
          if (data) {
            setBookings(data);
          } else {
            if (lastError?.name === 'AbortError') return;
            setBookings([]);
          }
        }
      } catch (err: any) {
        if (!cancelled && err?.name !== 'AbortError') setBookings([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadBookings();
    return () => { cancelled = true; };
  }, []);

  const hotels = useMemo(() => {
    const normalizeArray = (value: any): any[] => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') return [value];
      return [];
    };

    const out: any[] = [];
    for (const b of bookings) {
      const bookingHotels = normalizeArray(b.hotels);
      if (bookingHotels.length === 0) continue;

      const passengersArr = normalizeArray(b.passengers);
      const fallbackGuest =
        passengersArr?.[0]?.fullName ||
        passengersArr?.[0]?.name ||
        b.main_passenger_name ||
        '';

      bookingHotels.forEach((h: any, idx: number) => {
        const guestFromHotel =
          h?.guest_name || h?.guestName || h?.guest ||
          h?.guest_full_name || h?.main_guest ||
          h?.['hospede'] || h?.['hóspede'] || '';

        out.push({
          ...h,
          booking_id: b.id,
          hotel_index: idx,
          guest_name: guestFromHotel || fallbackGuest,
          hotel_display_name: h.hotel_display_name || h.hotel_name || h.hotelName || h.name || '',
          check_in: h.check_in || h.checkIn || '',
          check_out: h.check_out || h.checkOut || '',
        });
      });
    }
    return out;
  }, [bookings]);

  const handleDeleteHotel = async (bookingId: string, hotelIndex: number) => {
    setLoading(true);
    try {
      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;
      const currentHotels = Array.isArray(booking.hotels)
        ? [...booking.hotels]
        : (booking.hotels ? [booking.hotels] : []);
      const newHotels = [...currentHotels];
      newHotels.splice(hotelIndex, 1);
      await supabase.from('bookings').update({ hotels: newHotels }).eq('id', bookingId);
      setBookings((prev) => prev.map((b) => b.id === bookingId ? { ...b, hotels: newHotels } : b));
    } catch (err) {
      console.error('Erro ao excluir hospedagem:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredHotels = useMemo(() => hotels.filter(hotel => {
    const matchesSearch =
      (hotel.code || hotel.confirmationCode || hotel.confirm || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.hotel_display_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (hotel.guest_name || '').toLowerCase().includes(searchTerm.toLowerCase());

    const status = getHotelStatus(hotel);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'upcoming' && (status === 'upcoming' || status === 'unknown')) ||
      (statusFilter === 'completed' && status === 'completed');

    return matchesSearch && matchesStatus;
  }), [hotels, searchTerm, statusFilter]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Hospedagens</h2>
            <p className="text-muted-foreground">Gerencie todas as reservas de hotéis</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro Todas / Próximas / Concluídas */}
            <div className="flex items-center border rounded-lg p-1">
              {(['all', 'upcoming', 'completed'] as const).map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setStatusFilter(s)}
                  className="h-8 px-3 text-xs"
                >
                  {s === 'all' ? 'Todas' : s === 'upcoming' ? 'Próximas' : 'Concluídas'}
                </Button>
              ))}
            </div>

            {isAdmin ? <HotelForm /> : null}
          </div>
        </div>

        {/* Filtro de busca */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por localizador, hotel ou hóspede..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {loading ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground">Carregando hospedagens...</p>
          </div>
        ) : filteredHotels.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm || statusFilter !== 'all'
                ? 'Nenhuma hospedagem encontrada com os filtros aplicados.'
                : 'Nenhuma hospedagem cadastrada ainda.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Hospedagens</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {filteredHotels.map((hotel) => {
                const status = getHotelStatus(hotel);
                const safeHotel = {
                  ...hotel,
                  hotel_display_name: hotel.hotel_display_name || 'Hotel não informado',
                  guest_name: hotel.guest_name || 'Hóspede não identificado',
                };
                return (
                  <div key={hotel.booking_id + '-' + hotel.hotel_index} className="relative">
                    {status === 'completed' && (
                      <span className="absolute top-3 right-3 z-10 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium border border-border">
                        Concluída
                      </span>
                    )}
                    <HotelCard
                      hotel={safeHotel as any}
                      onDelete={isAdmin ? () => handleDeleteHotel(hotel.booking_id, hotel.hotel_index) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
