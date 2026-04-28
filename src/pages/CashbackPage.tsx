import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TrendingUp, Search, ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface CashbackEntry {
  id: string;
  company_id: string;
  booking_id: string;
  booking_created_at: string | null;
  paid_amount: number;
  cashback_amount: number;
  cashback_percent_used: number;
  created_at: string;
  bookings: { name: string } | null;
  companies: { name: string } | null;
}

interface Company {
  id: string;
  name: string;
}

export default function CashbackPage() {
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<CashbackEntry[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('all');

  // Carrega lista de empresas (admin: todas; não-admin: próprias)
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      if (isAdmin) {
        const { data } = await supabase
          .from('companies')
          .select('id, name')
          .order('name');
        setCompanies((data as Company[]) ?? []);
      } else {
        const { data: links } = await supabase
          .from('company_users')
          .select('company_id')
          .eq('user_id', user.id);
        const ids = (links ?? []).map((l: any) => l.company_id).filter(Boolean);
        if (ids.length > 0) {
          const { data } = await supabase
            .from('companies')
            .select('id, name')
            .in('id', ids)
            .order('name');
          setCompanies((data as Company[]) ?? []);
        }
      }
    };
    load();
  }, [isAdmin, user]);

  // Carrega entradas de cashback
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setIsLoading(true);

      let query = supabase
        .from('cashback_entries')
        .select(
          'id, company_id, booking_id, booking_created_at, paid_amount, cashback_amount, cashback_percent_used, created_at, bookings(name), companies(name)'
        )
        .order('created_at', { ascending: false });

      if (isAdmin && selectedCompany !== 'all') {
        query = query.eq('company_id', selectedCompany);
      }

      const { data, error } = await query;
      if (!error && data) {
        setEntries(data as unknown as CashbackEntry[]);
      }
      setIsLoading(false);
    };
    load();
  }, [isAdmin, user, selectedCompany]);

  // Filtro local por busca de texto
  const filtered = entries.filter((e) => {
    const bookingName = e.bookings?.name?.toLowerCase() ?? '';
    const companyName = e.companies?.name?.toLowerCase() ?? '';
    const term = searchTerm.toLowerCase();
    return bookingName.includes(term) || companyName.includes(term);
  });

  const totalCashback = filtered.reduce((acc, e) => acc + (e.cashback_amount ?? 0), 0);
  const totalReservas = filtered.length;

  const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const fmtDate = (s: string | null) => {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('pt-BR');
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold text-foreground">Cashback</h2>
          <p className="text-muted-foreground">
            Calculado sobre o valor pago em cada reserva
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Reservas com cashback</p>
                  <p className="text-3xl font-bold text-foreground">{totalReservas}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-primary/10 to-accent/20 border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Cashback total acumulado</p>
                  <p className="text-3xl font-bold text-accent-foreground">
                    {fmt(totalCashback)}
                  </p>
                </div>
                <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-accent-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por reserva ou empresa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {isAdmin && companies.length > 0 && (
            <Select value={selectedCompany} onValueChange={setSelectedCompany}>
              <SelectTrigger className="w-full sm:w-64">
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
        </div>

        {/* Listagem */}
        {isLoading ? (
          <div className="py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">Carregando cashback...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            Nenhum cashback encontrado.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry) => (
              <Card key={entry.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">
                        {entry.bookings?.name ?? '—'}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        {isAdmin && (
                          <span className="font-medium text-foreground">
                            {entry.companies?.name ?? '—'}
                          </span>
                        )}
                        <span>{fmtDate(entry.booking_created_at ?? entry.created_at)}</span>
                        <span className="font-mono text-xs opacity-60">
                          #{entry.booking_id.slice(0, 8)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Valor pago</p>
                        <p className="font-medium">{fmt(entry.paid_amount)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Cashback ({entry.cashback_percent_used ?? 1}%)</p>
                        <p className="font-bold text-primary">{fmt(entry.cashback_amount)}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/reservas/${entry.booking_id}`)}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Reserva
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
