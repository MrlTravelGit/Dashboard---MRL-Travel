import { useMemo, useState } from 'react';
import { useBooking } from '@/contexts/BookingContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { CarRentalCard } from '@/components/cards/CarRentalCard';
import { CarRentalForm } from '@/components/forms/CarRentalForm';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function CarRentalsPage() {
  const { carRentals, bookings, deleteCarRental } = useBooking();
  const { isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  const bookingTitleById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of bookings) map[b.id] = b.title;
    return map;
  }, [bookings]);

  const filteredCarRentals = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return carRentals;

    return carRentals.filter((car) => {
      const locator = String(car.locator || '').toLowerCase();
      const company = String(car.company || '').toLowerCase();
      const carModel = String(car.carModel || '').toLowerCase();
      const driver = String(car.driverName || '').toLowerCase();
      const bookingTitle = car.bookingId ? String(bookingTitleById[car.bookingId] || '').toLowerCase() : '';

      return (
        locator.includes(term) ||
        company.includes(term) ||
        carModel.includes(term) ||
        driver.includes(term) ||
        bookingTitle.includes(term)
      );
    });
  }, [carRentals, searchTerm, bookingTitleById]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Aluguel de Carro</h2>
            <p className="text-muted-foreground">Gerencie todas as reservas de veículos</p>
          </div>
          {isAdmin ? <CarRentalForm /> : null}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por localizador, locadora, modelo, condutor ou reserva..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {filteredCarRentals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm
                ? 'Nenhum aluguel encontrado com os filtros aplicados.'
                : 'Nenhum aluguel de carro cadastrado ainda.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredCarRentals.map((car) => (
              <CarRentalCard
                key={car.id}
                carRental={car}
                bookingTitle={car.bookingId ? bookingTitleById[car.bookingId] : undefined}
                showBookingLink
                onDelete={isAdmin ? deleteCarRental : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
