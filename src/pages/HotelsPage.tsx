import { useState } from 'react';
import { useBooking } from '@/contexts/BookingContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HotelCard } from '@/components/cards/HotelCard';
import { HotelForm } from '@/components/forms/HotelForm';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function HotelsPage() {
  const { hotels, deleteHotel } = useBooking();
  const { isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredHotels = hotels.filter((hotel) => {
    const q = searchTerm.toLowerCase();
    const locator = (hotel.locator || '').toLowerCase();
    const name = (hotel.hotelName || '').toLowerCase();
    const guest = (hotel.guestName || '').toLowerCase();
    return locator.includes(q) || name.includes(q) || guest.includes(q);
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

        {/* Hotel List */}
        {filteredHotels.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm 
                ? 'Nenhuma hospedagem encontrada com os filtros aplicados.' 
                : 'Nenhuma hospedagem cadastrada ainda.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredHotels.map((hotel) => (
              <HotelCard
                key={hotel.id}
                hotel={hotel}
                onDelete={isAdmin ? deleteHotel : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
