import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';

import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";

import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type CompanyRow = { id: string; name: string };

type EmployeeRow = {
  id: string;
  company_id: string;
  full_name: string;
  cpf: string | null;
  birth_date: string | null;
  companies?: { name: string } | null;
};

const safeFormatDate = (iso?: string | null) => {
  if (!iso) return 'Não informado';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Não informado';
  return format(d, 'dd/MM/yyyy', { locale: ptBR });
};

const onlyDigits = (v: string) => v.replace(/\D/g, '');

export default function EmployeesPage() {
  const { user, isAdmin } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [forcedCompanyId, setForcedCompanyId] = useState<string | null>(null);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  const fetchCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) throw error;
      setCompanies((data ?? []) as CompanyRow[]);
    } catch (e: any) {
      console.error(e);
      toast.error('Não foi possível carregar empresas.');
    }
  };

  const resolveForcedCompany = async () => {
    if (isAdmin) {
      setForcedCompanyId(null);
      return null;
    }

    if (!user) {
      setForcedCompanyId(null);
      return null;
    }

    const { data, error } = await supabase
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const cid = data?.company_id ?? null;
    setForcedCompanyId(cid);

    // Para usuário não-admin, já fixa o filtro na empresa dele
    if (cid) setSelectedCompanyId(cid);

    return cid;
  };

  const fetchEmployees = async (companyId: string | null) => {
    setIsLoading(true);
    try {
      let q = supabase
        .from('employees')
        .select('id, company_id, full_name, cpf, birth_date, companies(name)')
        .order('full_name', { ascending: true });

      if (companyId) q = q.eq('company_id', companyId);

      const { data, error } = await q;
      if (error) throw error;

      setEmployees((data ?? []) as EmployeeRow[]);
    } catch (e: any) {
      console.error(e);
      toast.error('Não foi possível carregar funcionários.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        if (isAdmin) {
          await fetchCompanies();
          setSelectedCompanyId(''); // "Todas"
        }

        const cid = await resolveForcedCompany();
        await fetchEmployees(isAdmin ? null : cid);
      } catch (e: any) {
        console.error(e);
        toast.error('Erro ao carregar funcionários.');
        setIsLoading(false);
      }
    };

    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, user?.id]);

  // Recarrega quando o admin muda o filtro
  useEffect(() => {
    if (!isAdmin) return;
    const companyId = selectedCompanyId && selectedCompanyId !== 'all' ? selectedCompanyId : null;
    void fetchEmployees(companyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId, isAdmin]);

  const filteredEmployees = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return employees;

    return employees.filter((e) => {
      const name = (e.full_name || '').toLowerCase();
      const cpf = onlyDigits(e.cpf || '');
      const companyName = (e.companies?.name || '').toLowerCase();
      const qDigits = onlyDigits(q);

      return (
        name.includes(q) ||
        companyName.includes(q) ||
        (!!qDigits && cpf.includes(qDigits))
      );
    });
  }, [employees, searchTerm]);

  const companyLabel = useMemo(() => {
    const idToShow = forcedCompanyId || selectedCompanyId;
    if (!idToShow) return 'Todas as empresas';
    const c = companies.find((x) => x.id === idToShow);
    return c?.name || 'Empresa';
  }, [companies, forcedCompanyId, selectedCompanyId]);

const handleDeleteEmployee = async (employeeId: string) => {
  setIsDeletingId(employeeId);
  try {
    // Primary source: employees table
    const { error } = await supabase.from('employees').delete().eq('id', employeeId);
    if (error) throw error;

    // Update local state to remove deleted employee
    setEmployees((prev) => prev.filter((e) => e.id !== employeeId));

    toast.success('Funcionário removido com sucesso');
    // No full refetch needed because we've updated state
  } catch (err: any) {
    console.error(err);
    // If deletion failed, attempt to remove possible binding tables as fallback
    try {
      // Example fallback: booking_passengers or company_users (if used as link)
      const { error: e1 } = await (supabase as any).from('booking_passengers').delete().eq('employee_id', employeeId);
      if (!e1) {
        setEmployees((prev) => prev.filter((e) => e.id !== employeeId));
        toast.success('Vínculo de passageiro removido.');
        setIsDeletingId(null);
        return;
      }
    } catch (fallbackErr) {
      console.error('Fallback delete error:', fallbackErr);
    }

    toast.error('Não foi possível remover o funcionário');
  } finally {
    setIsDeletingId(null);
  }
};

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-6 w-6" />
              <h1 className="text-2xl font-bold">Funcionários</h1>
            </div>
            <p className="text-muted-foreground">
              Estes passageiros são gerados automaticamente a partir das reservas cadastradas no sistema.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {isAdmin ? (
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger className="w-full sm:w-[260px]">
                  <SelectValue placeholder="Selecione a empresa" />
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
            ) : (
              <div className="text-sm text-muted-foreground self-center px-2">
                {companyLabel}
              </div>
            )}

            <Input
              placeholder="Buscar por nome, CPF ou empresa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-[300px]"
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Passageiros Frequentes</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground">Carregando...</div>
            ) : filteredEmployees.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                Nenhum funcionário encontrado.
              </div>
            ) : (
              <div className="w-full overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 font-medium">Nome</th>
                      <th className="text-left py-3 font-medium">Empresa</th>
                      <th className="text-left py-3 font-medium">CPF</th>
                      <th className="text-left py-3 font-medium">Nascimento</th>
                      <th className="text-left py-3 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((e) => (
                      <tr key={e.id} className="border-b border-border/60">
                        <td className="py-3 font-medium">{e.full_name}</td>
                        <td className="py-3">{e.companies?.name || 'Não informado'}</td>
                        <td className="py-3">{e.cpf || 'Não informado'}</td>
                        <td className="py-3">{safeFormatDate(e.birth_date)}</td>
                        <td className="py-3">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:bg-destructive/10"
                                disabled={isDeletingId === e.id}
                                aria-label={`Remover ${e.full_name}`}
                              >
                                {isDeletingId === e.id ? (
                                  <Trash2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remover passageiro?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja remover {e.full_name}? Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground"
                                  onClick={() => handleDeleteEmployee(e.id)}
                                >
                                  Remover
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </td>
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
