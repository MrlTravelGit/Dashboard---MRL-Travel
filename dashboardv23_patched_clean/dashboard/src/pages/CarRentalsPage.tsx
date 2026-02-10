import { useState } from 'react';
import { useBooking } from '@/contexts/BookingContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { CarRentalCard } from '@/components/cards/CarRentalCard';
import { CarRentalForm } from '@/components/forms/CarRentalForm';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function CarRentalsPage() {
  const { carRentals, deleteCarRental } = useBooking();
  const { isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCarRentals = carRentals.filter(car => {
    return (
      car.locator.toLowerCase().includes(searchTerm.toLowerCase()) ||
      car.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      car.carModel.toLowerCase().includes(searchTerm.toLowerCase()) ||
      car.driverName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

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

        {/* Filters */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por localizador, locadora, modelo ou condutor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Car Rental List */}
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
                onDelete={isAdmin ? deleteCarRental : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
