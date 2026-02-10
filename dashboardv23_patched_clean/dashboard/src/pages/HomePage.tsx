import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, Package, Building2 } from 'lucide-react';
import { SavingsReportDialog } from '@/components/reports/SavingsReportDialog';
import { supabase } from '@/integrations/supabase/client';

interface BookingFromDB {
  id: string;
  name: string;
  total_paid: number | null;
  total_original: number | null;
}

export default function HomePage() {
  const [bookings, setBookings] = useState<BookingFromDB[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      
      const { data: bookingsData } = await supabase
        .from('bookings')
        .select('id, name, total_paid, total_original')
        .order('created_at', { ascending: false });
      
      if (bookingsData) {
        setBookings(bookingsData);
      }
      
      setIsLoading(false);
    };
    
    fetchData();
  }, []);

  const totalPaid = bookings.reduce((acc, b) => acc + (b.total_paid || 0), 0);
  const totalOriginal = bookings.reduce((acc, b) => acc + (b.total_original || 0), 0);
  const totalSavings = totalOriginal - totalPaid;
  const savingsPercentage = totalOriginal > 0 ? ((totalSavings / totalOriginal) * 100).toFixed(1) : '0';

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
            <p className="text-muted-foreground">Visão geral das suas viagens corporativas</p>
          </div>
          <SavingsReportDialog />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total de Reservas</p>
                  <p className="text-3xl font-bold text-foreground">{bookings.length}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Package className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Pago</p>
                  <p className="text-3xl font-bold text-foreground">
                    R$ {totalPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-secondary/10 flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-secondary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-primary/10 to-accent/20 border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Economia Total Gerada</p>
                  <p className="text-3xl font-bold text-accent-foreground">
                    R$ {totalSavings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {savingsPercentage}% de economia
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-accent-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
