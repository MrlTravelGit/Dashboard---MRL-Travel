import { useEffect, useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, Package, Building2 } from 'lucide-react';
import { SavingsReportDialog } from '@/components/reports/SavingsReportDialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BookingFromDB {
  id: string;
  name: string;
  company_id: string;
  total_paid: number | null;
  total_original: number | null;
}

interface Company {
  id: string;
  name: string;
}

export default function HomePage() {
  const { isAdmin, user } = useAuth();

  const [bookings, setBookings] = useState<BookingFromDB[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = usePersistedState<string>('home:selectedCompany', 'all');
  const [totalCashback, setTotalCashback] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  // Carrega lista de empresas para o filtro do admin
  useEffect(() => {
    if (!isAdmin) return;
    const load = async () => {
      const { data } = await supabase
        .from('companies')
        .select('id, name')
        .order('name');
      setCompanies((data as Company[]) ?? []);
    };
    load();
  }, [isAdmin]);

  // Carrega bookings (e cashback) com base no filtro
  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      setIsLoading(true);

      // --- Bookings ---
      let bookingsQuery = supabase
        .from('bookings')
        .select('id, name, company_id, total_paid, total_original')
        .order('created_at', { ascending: false });

      if (isAdmin && selectedCompany !== 'all') {
        bookingsQuery = bookingsQuery.eq('company_id', selectedCompany);
      }

      const { data: bookingsData } = await bookingsQuery;
      if (bookingsData) setBookings(bookingsData as BookingFromDB[]);

      // --- Cashback ---
      let cashbackQuery = supabase
        .from('cashback_entries')
        .select('cashback_amount');

      if (isAdmin && selectedCompany !== 'all') {
        cashbackQuery = cashbackQuery.eq('company_id', selectedCompany);
      }

      const { data: cashbackData } = await cashbackQuery;
      const sum = (cashbackData ?? []).reduce(
        (acc: number, e: any) => acc + (e.cashback_amount ?? 0),
        0
      );
      setTotalCashback(sum);

      setIsLoading(false);
    };
    fetchData();
  }, [isAdmin, user, selectedCompany]);

  const totalPaid = bookings.reduce((acc, b) => acc + (b.total_paid || 0), 0);
  const totalOriginal = bookings.reduce(
    (acc, b) => acc + (b.total_original || 0),
    0
  );
  const totalSavings = totalOriginal - totalPaid;
  const savingsPercentage =
    totalOriginal > 0
      ? ((totalSavings / totalOriginal) * 100).toFixed(1)
      : '0';

  const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
            <p className="text-muted-foreground">
              Visão geral das suas viagens corporativas
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Filtro por empresa — somente admin */}
            {isAdmin && companies.length > 0 && (
              <Select value={selectedCompany} onValueChange={setSelectedCompany}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Todas as empresas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as empresas</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <SavingsReportDialog />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="card-elevated">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total de Reservas</p>
                  <p className="text-3xl font-bold text-foreground">
                    {bookings.length}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-background/50 border border-border/50 flex items-center justify-center shadow-inner">
                  <Package className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Pago</p>
                  <p className="text-3xl font-bold text-foreground">
                    R$ {fmt(totalPaid)}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-background/50 border border-border/50 flex items-center justify-center shadow-inner">
                  <Building2 className="h-6 w-6 text-secondary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated bg-gradient-to-br from-primary/10 to-accent/20 border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Economia Total Gerada
                  </p>
                  <p className="text-3xl font-bold text-accent-foreground">
                    R$ {fmt(totalSavings)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {savingsPercentage}% de economia
                  </p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-background/50 border border-accent/20 flex items-center justify-center shadow-inner">
                  <TrendingUp className="h-6 w-6 text-accent-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Cashback Total</p>
                  <p className="text-3xl font-bold text-foreground">
                    R$ {fmt(totalCashback)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">1% por reserva</p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-background/50 border border-border/50 flex items-center justify-center shadow-inner">
                  <TrendingUp className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
