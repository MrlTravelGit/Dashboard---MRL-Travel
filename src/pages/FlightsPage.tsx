import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FlightCard } from '@/components/cards/FlightCard';
import { FlightForm } from '@/components/forms/FlightForm';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import type { Flight } from '@/types/booking';

type FlightRow = Flight & { __booking_id: string };

export default function FlightsPage() {
  const { toast } = useToast();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [flights, setFlights] = useState<FlightRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [airlineFilter, setAirlineFilter] = useState<string>('all');

  const fetchFlights = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, flights')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows: FlightRow[] = [];
      for (const booking of data || []) {
        const bookingFlights = (booking.flights as unknown as Flight[]) || [];
        bookingFlights.forEach((f, index) => {
          const flightId = f.id || `${booking.id}:${index}`;
          rows.push({ ...f, id: flightId, __booking_id: booking.id });
        });
      }
      setFlights(rows);
    } catch (err: any) {
      console.error('Error fetching flights:', err);
      toast({
        title: 'Erro ao carregar voos',
        description: err?.message || 'Não foi possível buscar os voos no banco.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const deleteFlight = async (flightId: string) => {
    const target = flights.find(f => f.id === flightId);
    if (!target) return;

    try {
      // Pega as flights atuais do booking e remove apenas o item solicitado
      const { data: booking, error: readErr } = await supabase
        .from('bookings')
        .select('id, flights, hotels, car_rentals, transfers')
        .eq('id', target.__booking_id)
        .single();
      if (readErr) throw readErr;

      const currentFlights = ((booking.flights as unknown) as Flight[]) || [];
      const nextFlights = currentFlights.filter((f, idx) => {
        const id = f.id || `${booking.id}:${idx}`;
        return id !== flightId;
      });

      const hasOtherData =
        (booking.hotels as any)?.length ||
        (booking.car_rentals as any)?.length ||
        (booking.transfers as any)?.length;

      if (nextFlights.length === 0 && !hasOtherData) {
        // Se não sobrou nada no booking, apaga a linha inteira
        const { error: delErr } = await supabase.from('bookings').delete().eq('id', booking.id);
        if (delErr) throw delErr;
      } else {
        const { error: updErr } = await supabase
          .from('bookings')
          .update({ flights: nextFlights })
          .eq('id', booking.id);
        if (updErr) throw updErr;
      }

      toast({
        title: 'Voo excluído',
        description: 'O voo foi removido com sucesso.',
      });
      await fetchFlights();
    } catch (err: any) {
      console.error('Error deleting flight:', err);
      toast({
        title: 'Erro ao excluir',
        description: err?.message || 'Não foi possível excluir o voo.',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (!isAuthLoading && user) {
      fetchFlights();
    }
  }, [isAuthLoading, user]);

const filteredFlights = useMemo(() => flights.filter(flight => {
  const term = searchTerm.toLowerCase();

  const locator = (flight.locator ?? '').toLowerCase();
  const passengerName = (flight.passengerName ?? '').toLowerCase();
  const origin = (flight.origin ?? '').toLowerCase();
  const destination = (flight.destination ?? '').toLowerCase();
  const flightNumber = (flight.flightNumber ?? '').toLowerCase();

  const matchesSearch =
    locator.includes(term) ||
    passengerName.includes(term) ||
    origin.includes(term) ||
    destination.includes(term) ||
    flightNumber.includes(term);

  const matchesAirline = airlineFilter === 'all' || flight.airline === airlineFilter;

  return matchesSearch && matchesAirline;
}), [flights, searchTerm, airlineFilter]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Voos</h2>
            <p className="text-muted-foreground">Gerencie todas as passagens aéreas</p>
          </div>
          <FlightForm onSaved={fetchFlights} />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por localizador, passageiro, origem, destino..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={airlineFilter} onValueChange={setAirlineFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Todas as companhias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as companhias</SelectItem>
              <SelectItem value="LATAM">LATAM</SelectItem>
              <SelectItem value="GOL">GOL</SelectItem>
              <SelectItem value="AZUL">AZUL</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Flight List */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Carregando voos...</p>
          </div>
        ) : filteredFlights.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm || airlineFilter !== 'all' 
                ? 'Nenhum voo encontrado com os filtros aplicados.' 
                : 'Nenhum voo cadastrado ainda.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredFlights.map((flight) => (
              <FlightCard key={flight.id} flight={flight} onDelete={deleteFlight} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
