import { useEffect, useMemo, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useBooking } from '@/contexts/BookingContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { CarRentalCard } from '@/components/cards/CarRentalCard';
import { CarRentalForm } from '@/components/forms/CarRentalForm';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { getCarStatus } from '@/utils/statusUtils';

interface Company {
  id: string;
  name: string;
}

export default function CarRentalsPage() {
  const { carRentals, bookings, deleteCarRental } = useBooking();
  const { isAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = usePersistedState<'all' | 'upcoming' | 'completed'>('cars:statusFilter', 'all');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = usePersistedState<string>('cars:selectedCompany', 'all');

  // Carrega lista de empresas para o filtro do admin
  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      const { data } = await supabase.from('companies').select('id, name').order('name');
      setCompanies((data as Company[]) ?? []);
    };
    load();
  }, [isAdmin]);

  const bookingTitleById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of bookings) map[b.id] = b.title;
    return map;
  }, [bookings]);

  // Mapa de bookingId -> company_id para filtrar aluguéis
  const bookingCompanyById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of bookings) map[b.id] = b.company_id;
    return map;
  }, [bookings]);

  const filteredCarRentals = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();

    return carRentals.filter((car) => {
      const matchesSearch = !term || (
        String(car.locator || '').toLowerCase().includes(term) ||
        String(car.company || '').toLowerCase().includes(term) ||
        String(car.carModel || '').toLowerCase().includes(term) ||
        String(car.driverName || '').toLowerCase().includes(term) ||
        (car.bookingId ? String(bookingTitleById[car.bookingId] || '').toLowerCase().includes(term) : false)
      );

      const matchesCompany =
        !isAdmin ||
        selectedCompany === 'all' ||
        (car.bookingId && bookingCompanyById[car.bookingId] === selectedCompany);

      const status = getCarStatus(car);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'upcoming' && (status === 'upcoming' || status === 'unknown')) ||
        (statusFilter === 'completed' && status === 'completed');

      return matchesSearch && matchesCompany && matchesStatus;
    });
  }, [carRentals, searchTerm, bookingTitleById, bookingCompanyById, statusFilter, selectedCompany, isAdmin]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Aluguel de Carro</h2>
            <p className="text-muted-foreground">Gerencie todas as reservas de veículos</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filtro por empresa — somente admin */}
            {isAdmin && companies.length > 0 && (
              <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Todas as empresas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as empresas</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

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

            {isAdmin ? <CarRentalForm /> : null}
          </div>
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
              {searchTerm || statusFilter !== 'all' || selectedCompany !== 'all'
                ? 'Nenhum aluguel encontrado com os filtros aplicados.'
                : 'Nenhum aluguel de carro cadastrado ainda.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredCarRentals.map((car) => {
              const status = getCarStatus(car);
              return (
                <div key={car.id} className="relative">
                  {status === 'completed' && (
                    <span className="absolute top-3 right-3 z-10 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium border border-border">
                      Concluído
                    </span>
                  )}
                  <CarRentalCard
                    carRental={car}
                    bookingTitle={car.bookingId ? bookingTitleById[car.bookingId] : undefined}
                    showBookingLink
                    onDelete={isAdmin ? deleteCarRental : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
