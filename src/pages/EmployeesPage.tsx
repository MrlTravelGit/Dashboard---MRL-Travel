import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type CompanyRef = { name: string } | null;

type EmployeeRow = {
  id: string;
  company_id: string;
  full_name: string;
  created_at?: string;
  companies?: CompanyRef;
};

type BookingRow = {
  company_id: string;
  created_at: string;
  flights: any;
  hotels: any;
  companies?: CompanyRef;
};

interface EmployeeSummary {
  id: string;
  name: string;
  companyId: string;
  companyName?: string;
  trips: number;
  lastTrip?: string;
}

const normalizeNameKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const safeFormatDate = (iso?: string) => {
  if (!iso) return 'Não informado';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Não informado';
  return format(d, 'dd/MM/yyyy', { locale: ptBR });
};

const extractNamesFromBooking = (booking: BookingRow): string[] => {
  const names: string[] = [];

  const flights = Array.isArray(booking.flights) ? booking.flights : [];
  for (const f of flights) {
    const raw = String(f?.passengerName ?? '').trim();
    if (raw) names.push(raw);
  }

  const hotels = Array.isArray(booking.hotels) ? booking.hotels : [];
  for (const h of hotels) {
    const raw = String(h?.guestName ?? '').trim();
    if (raw) names.push(raw);
  }

  // Remove duplicados dentro da mesma reserva
  return Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
};

export default function EmployeesPage() {
  const { user, isAdmin } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [forcedCompanyId, setForcedCompanyId] = useState<string | null>(null);

  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);

  const fetchEmployees = async () => {
    setIsLoading(true);

    try {
      let companyId: string | null = null;

      if (!isAdmin) {
        if (!user) throw new Error('Usuário não autenticado.');

        const { data: linkData, error: linkError } = await supabase
          .from('company_users')
          .select('company_id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (linkError) throw linkError;
        if (!linkData?.company_id) throw new Error('Usuário não vinculado a uma empresa.');

        companyId = linkData.company_id;
        setForcedCompanyId(companyId);
      } else {
        setForcedCompanyId(null);
      }

      // 1) Carrega todos os funcionários cadastrados (passageiros)
      const empQuery = supabase
        .from('employees')
        .select('id, company_id, full_name, created_at, companies(name)')
        .order('full_name', { ascending: true });

      const empRes = companyId ? await empQuery.eq('company_id', companyId) : await empQuery;
      if (empRes.error) throw empRes.error;

      const empRows = (empRes.data ?? []) as EmployeeRow[];

      // Index para match rápido por (company_id + nome normalizado)
      const index = new Map<string, EmployeeSummary>();
      for (const e of empRows) {
        const key = `${e.company_id}:${normalizeNameKey(e.full_name)}`;
        index.set(key, {
          id: e.id,
          name: e.full_name,
          companyId: e.company_id,
          companyName: e.companies?.name,
          trips: 0,
          lastTrip: undefined,
        });
      }

      // 2) Carrega reservas e computa métricas (qtd. de viagens e última reserva)
      // Observação: caso os voos ainda tragam apenas o passageiro principal,
      // ainda assim os funcionários aparecerão na lista. As métricas vão melhorando
      // conforme mais nomes forem registrados nas reservas.
      const bookingQuery = supabase
        .from('bookings')
        .select('company_id, created_at, flights, hotels, companies(name)')
        .order('created_at', { ascending: false });

      const bookingRes = companyId ? await bookingQuery.eq('company_id', companyId) : await bookingQuery;
      if (bookingRes.error) throw bookingRes.error;

      const rows = (bookingRes.data ?? []) as BookingRow[];

      for (const b of rows) {
        const names = extractNamesFromBooking(b);
        for (const rawName of names) {
          const key = `${b.company_id}:${normalizeNameKey(rawName)}`;
          const current = index.get(key);
          if (!current) continue;

          current.trips += 1;
          if (!current.lastTrip || (b.created_at && b.created_at > current.lastTrip)) {
            current.lastTrip = b.created_at;
          }
        }
      }

      const list = Array.from(index.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      setEmployees(list);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar funcionários');
      setEmployees([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return employees;

    return employees.filter((p) => {
      const byName = p.name.toLowerCase().includes(term);
      const byCompany = (p.companyName ?? '').toLowerCase().includes(term);
      return byName || byCompany;
    });
  }, [employees, searchTerm]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">Funcionários</h1>
            <p className="text-muted-foreground">
              Estes passageiros são gerados automaticamente a partir das reservas cadastradas no sistema.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Passageiros Frequentes</CardTitle>
              <div className="w-full sm:w-[380px]">
                <Input
                  placeholder={isAdmin ? 'Buscar por nome ou empresa...' : 'Buscar por nome...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {!isAdmin && forcedCompanyId && (
              <p className="text-sm text-muted-foreground">
                Você está visualizando apenas os funcionários da sua empresa.
              </p>
            )}
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground">Carregando...</div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                Nenhum funcionário encontrado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="w-full overflow-x-auto">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="py-3 text-left font-medium">Nome</th>
                        {isAdmin && <th className="py-3 text-left font-medium">Empresa</th>}
                        <th className="py-3 text-left font-medium">Qtd. de viagens</th>
                        <th className="py-3 text-left font-medium">Última reserva</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-3 font-medium">{p.name}</td>
                          {isAdmin && <td className="py-3">{p.companyName ?? 'Não informado'}</td>}
                          <td className="py-3">{p.trips}</td>
                          <td className="py-3">{safeFormatDate(p.lastTrip)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
