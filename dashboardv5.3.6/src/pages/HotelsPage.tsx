

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
  let cancelled = false;

  const loadBookings = async () => {
    setLoading(true);
    try {
      // Em alguns bancos antigos, a coluna main_passenger_name não existe.
      // Para manter compatibilidade, tentamos com e sem ela.
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
        const details = (error?.details || '').toLowerCase();
        const hint = (error?.hint || '').toLowerCase();
        const isMissingMainPassenger =
          msg.includes('main_passenger_name') ||
          details.includes('main_passenger_name') ||
          hint.includes('main_passenger_name') ||
          msg.includes('column') && msg.includes('does not exist') && msg.includes('main_passenger_name');

        // Se falhou por falta da coluna, tenta o próximo select.
        if (isMissingMainPassenger) continue;

        // Se falhou por outro motivo, interrompe.
        break;
      }

      if (!cancelled) {
        if (data) {
          setBookings(data);
        } else {
          // Silencia aborts (ex: navegação rápida)
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
  return () => {
    cancelled = true;
  };
}, []);

  // Flatten bookings.hotels para lista de hospedagens
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
        h?.guest_name ||
        h?.guestName ||
        h?.guest ||
        h?.guest_full_name ||
        h?.main_guest ||
        h?.['hospede'] ||
        h?.['hóspede'] ||
        '';

      out.push({
        ...h,
        booking_id: b.id,
        hotel_index: idx,
        // Nome do hóspede: preferir o que vier do hotel, depois passageiros, depois main_passenger_name
        guest_name: guestFromHotel || fallbackGuest,
        // Nome do hotel: preferir display/name, depois fallbacks
        hotel_display_name: h.hotel_display_name || h.hotel_name || h.hotelName || h.name || '',
        check_in: h.check_in || h.checkIn || '',
        check_out: h.check_out || h.checkOut || '',
      });
    });
  }
  return out;
}, [bookings]);

  // Excluir hospedagem = remover do array hotels e atualizar booking
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

  // Filtro de busca
  const filteredHotels = useMemo(() => hotels.filter(hotel => {
    return (
      (hotel.code || hotel.confirmationCode || hotel.confirm || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
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
                  {filteredHotels.map((hotel) => {
                    const safeHotel = {
                      ...hotel,
                      hotel_display_name: hotel.hotel_display_name || 'Hotel não informado',
                      guest_name: hotel.guest_name || 'Hóspede não identificado',
                    };
                    return (
                      <HotelCard
                        key={hotel.booking_id + '-' + hotel.hotel_index}
                        hotel={safeHotel as any}
                        onDelete={isAdmin ? () => handleDeleteHotel(hotel.booking_id, hotel.hotel_index) : undefined}
                      />
                    );
                  })}
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
