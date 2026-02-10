import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileDown, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BookingFromDB {
  id: string;
  name: string;
  total_paid: number | null;
  total_original: number | null;
  created_at: string;
}

const months = [
  { value: '01', label: 'Janeiro' },
  { value: '02', label: 'Fevereiro' },
  { value: '03', label: 'Março' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Maio' },
  { value: '06', label: 'Junho' },
  { value: '07', label: 'Julho' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
];

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

export function SavingsReportDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>(currentYear.toString());
  const [isLoading, setIsLoading] = useState(false);
  const [reportData, setReportData] = useState<{
    bookings: BookingFromDB[];
    totalPaid: number;
    totalOriginal: number;
    totalSavings: number;
    savingsPercentage: string;
  } | null>(null);

  const handleGenerateReport = async () => {
    if (!selectedMonth || !selectedYear) {
      toast.error('Selecione o mês e o ano');
      return;
    }

    setIsLoading(true);

    try {
      const startDate = `${selectedYear}-${selectedMonth}-01`;
      const endDate = new Date(parseInt(selectedYear), parseInt(selectedMonth), 0);
      const endDateStr = `${selectedYear}-${selectedMonth}-${endDate.getDate().toString().padStart(2, '0')}`;

      const { data: bookingsData, error } = await supabase
        .from('bookings')
        .select('id, name, total_paid, total_original, created_at')
        .gte('created_at', `${startDate}T00:00:00`)
        .lte('created_at', `${endDateStr}T23:59:59`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const bookings = bookingsData || [];
      const totalPaid = bookings.reduce((acc, b) => acc + (b.total_paid || 0), 0);
      const totalOriginal = bookings.reduce((acc, b) => acc + (b.total_original || 0), 0);
      const totalSavings = totalOriginal - totalPaid;
      const savingsPercentage = totalOriginal > 0 ? ((totalSavings / totalOriginal) * 100).toFixed(1) : '0';

      setReportData({
        bookings,
        totalPaid,
        totalOriginal,
        totalSavings,
        savingsPercentage,
      });
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Erro ao gerar relatório');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (!reportData) return;

    const monthLabel = months.find(m => m.value === selectedMonth)?.label || '';
    const headers = ['Reserva', 'Valor Pago', 'Valor Original', 'Economia', 'Data'];
    const rows = reportData.bookings.map(b => [
      b.name,
      (b.total_paid || 0).toFixed(2),
      (b.total_original || 0).toFixed(2),
      ((b.total_original || 0) - (b.total_paid || 0)).toFixed(2),
      new Date(b.created_at).toLocaleDateString('pt-BR'),
    ]);

    rows.push([]);
    rows.push(['TOTAIS', reportData.totalPaid.toFixed(2), reportData.totalOriginal.toFixed(2), reportData.totalSavings.toFixed(2), '']);
    rows.push(['Economia (%)', `${reportData.savingsPercentage}%`, '', '', '']);

    const csvContent = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio-economia-${monthLabel}-${selectedYear}.csv`;
    link.click();

    toast.success('Relatório exportado com sucesso!');
  };

  const resetDialog = () => {
    setReportData(null);
    setSelectedMonth('');
    setSelectedYear(currentYear.toString());
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) resetDialog(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileDown className="h-4 w-4" />
          Relatório de Economia
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Relatório de Economia Mensal
          </DialogTitle>
          <DialogDescription>
            Selecione o período para gerar o relatório de economia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Mês</label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o mês" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Ano</label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o ano" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleGenerateReport} disabled={isLoading} className="w-full">
            {isLoading ? 'Gerando...' : 'Gerar Relatório'}
          </Button>

          {reportData && (
            <div className="space-y-4 pt-4 border-t">
              <div className="text-sm font-medium text-foreground">
                Resultado - {months.find(m => m.value === selectedMonth)?.label} de {selectedYear}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground">Total de Reservas</p>
                  <p className="text-lg font-bold text-foreground">{reportData.bookings.length}</p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground">Valor Original</p>
                  <p className="text-lg font-bold text-foreground">
                    R$ {reportData.totalOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs text-muted-foreground">Valor Pago</p>
                  <p className="text-lg font-bold text-foreground">
                    R$ {reportData.totalPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                  <p className="text-xs text-muted-foreground">Economia Total</p>
                  <p className="text-lg font-bold text-primary">
                    R$ {reportData.totalSavings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground">{reportData.savingsPercentage}%</p>
                </div>
              </div>

              <Button onClick={handleExportCSV} variant="secondary" className="w-full gap-2">
                <FileDown className="h-4 w-4" />
                Exportar CSV
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
