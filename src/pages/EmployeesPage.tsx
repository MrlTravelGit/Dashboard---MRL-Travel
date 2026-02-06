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

type BookingCompany = { name: string } | null;

type BookingRow = {
  company_id: string;
  created_at: string;
  flights: any;
  companies?: BookingCompany;
};

interface PassengerFromFlights {
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

export default function EmployeesPage() {
  const { user, isAdmin } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [forcedCompanyId, setForcedCompanyId] = useState<string | null>(null);

  const [passengers, setPassengers] = useState<PassengerFromFlights[]>([]);

  const fetchPassengers = async () => {
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

      const baseQuery = supabase
        .from('bookings')
        .select('company_id, created_at, flights, companies(name)')
        .order('created_at', { ascending: false });

      const bookingsRes = companyId ? await baseQuery.eq('company_id', companyId) : await baseQuery;

      if (bookingsRes.error) throw bookingsRes.error;

      const rows = (bookingsRes.data ?? []) as BookingRow[];

      const map = new Map<string, PassengerFromFlights>();

      for (const b of rows) {
        const flights = Array.isArray(b.flights) ? b.flights : [];

        for (const f of flights) {
          const rawName = String(f?.passengerName ?? '').trim();
          if (!rawName) continue;

          const key = `${b.company_id}:${normalizeNameKey(rawName)}`;

          const current = map.get(key);
          if (!current) {
            map.set(key, {
              name: rawName,
              companyId: b.company_id,
              companyName: b.companies?.name,
              trips: 1,
              lastTrip: b.created_at,
            });
          } else {
            current.trips += 1;
            if (!current.lastTrip || (b.created_at && b.created_at > current.lastTrip)) {
              current.lastTrip = b.created_at;
            }
          }
        }
      }

      const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

      setPassengers(list);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar funcionários a partir dos voos');
      setPassengers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPassengers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return passengers;

    return passengers.filter((p) => {
      const byName = p.name.toLowerCase().includes(term);
      const byCompany = (p.companyName ?? '').toLowerCase().includes(term);
      return byName || byCompany;
    });
  }, [passengers, searchTerm]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold">Funcionários</h1>
            <p className="text-muted-foreground">
              Estes passageiros são gerados automaticamente a partir das reservas (voos) cadastradas no sistema.
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

            {!isAdmin && (
              <p className="text-sm text-muted-foreground">
                Se algum passageiro aparecer como "Não identificado", preencha o nome no momento de importar o voo.
              </p>
            )}
          </CardHeader>

          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground">Carregando...</div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                Nenhum passageiro encontrado a partir dos voos cadastrados.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
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
                      <tr key={`${p.companyId}:${normalizeNameKey(p.name)}`} className="border-b last:border-0">
                        <td className="py-3 font-medium">{p.name}</td>
                        {isAdmin && <td className="py-3">{p.companyName ?? 'Não informado'}</td>}
                        <td className="py-3">{p.trips}</td>
                        <td className="py-3">{safeFormatDate(p.lastTrip)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
