import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBooking } from '@/contexts/BookingContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FlightCard } from '@/components/cards/FlightCard';
import { HotelCard } from '@/components/cards/HotelCard';
import { CarRentalCard } from '@/components/cards/CarRentalCard';
import { SavingsCard } from '@/components/cards/SavingsCard';
import { AirlineLogos } from '@/components/AirlineLogo';
import { useNavigate } from "react-router-dom";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, Package, Plane, Building2, Car, LayoutGrid, LayoutList, Link, Loader2, Trash2, Users, Calendar } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Flight, Hotel, CarRental, Company } from '@/types/booking';
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '@/integrations/supabase/client';

interface BookingFromDB {
  id: string;
  name: string;
  company_id: string;
  source_url: string | null;
  flights: Flight[] | null;
  hotels: Hotel[] | null;
  car_rentals: CarRental[] | null;
  passengers: any[] | null;
  total_paid: number | null;
  total_original: number | null;
  created_at: string;
}

export default function BookingsPage() {
  const { isAdmin } = useAuth();
  const { refresh: refreshBookingContext } = useBooking();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'landscape'>('card');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [bookings, setBookings] = useState<BookingFromDB[]>([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const [isLoadingBookings, setIsLoadingBookings] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [autoRegisterEmployees, setAutoRegisterEmployees] = useState(true);
  
  const [formData, setFormData] = useState({
    companyId: '',
    url: '',
    title: '',
    passengerName: '',
    totalPaid: '',
    totalOriginal: '',
  });

  const fetchBookings = async () => {
    setIsLoadingBookings(true);
    let timeoutId: any;
    let finished = false;
    try {
      // Timeout de segurança
      await Promise.race([
        (async () => {
          let query = supabase
            .from('bookings')
            .select('id, name, company_id, source_url, flights, hotels, car_rentals, passengers, total_paid, total_original, created_at')
            .order('created_at', { ascending: false });
          const { data, error } = await query;
          finished = true;
          if (!error && data) {
            const typedBookings: BookingFromDB[] = (data ?? []).map((b: any) => ({
              ...b,
              flights: Array.isArray(b.flights) ? b.flights : [],
              hotels: Array.isArray(b.hotels) ? b.hotels : [],
              car_rentals: Array.isArray(b.car_rentals) ? b.car_rentals : [],
              passengers: Array.isArray(b.passengers) ? b.passengers : [],
            }));
            setBookings(typedBookings);
          } else if (error) {
            const logObj = {
              message: error.message,
              code: error.code,
              details: error.details,
              hint: error.hint,
              stack: error.stack,
              user_id: (supabase.auth.user && supabase.auth.user()?.id) || 'desconhecido',
            };
            console.error('Erro ao buscar reservas:', logObj);
            toast({ title: 'Erro ao buscar reservas', description: error.message || String(error), variant: 'destructive' });
            if (!data || data.length === 0) {
              console.warn('Possível bloqueio por RLS/policies. user_id:', logObj.user_id);
            }
          }
        })(),
        new Promise((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            if (!finished) {
              reject(new Error('Timeout ao buscar reservas (12s)'));
            }
          }, 12000);
        })
      ]);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      toast({ title: 'Erro ao buscar reservas', description: err.message || String(err), variant: 'destructive' });
      console.error('Erro ao buscar reservas (catch):', err);
    } finally {
      clearTimeout(timeoutId);
      setIsLoadingBookings(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchEmpresasDoUsuario = async () => {
      setIsLoadingCompanies(true);
      try {
        const user = supabase.auth.user && supabase.auth.user();
        if (!user) {
          setCompanies([]);
          return;
        }
        // Busca company_ids vinculados ao usuário
        const { data: vinculos, error: vincErr } = await supabase
          .from('company_users')
          .select('company_id')
          .eq('user_id', user.id);
        if (vincErr) {
          console.error('Erro ao buscar vínculos company_users:', vincErr);
          setCompanies([]);
          return;
        }
        const companyIds = (vinculos ?? []).map((v: any) => v.company_id);
        if (companyIds.length === 0) {
          setCompanies([]);
          return;
        }
        // Busca empresas
        const { data: companiesData, error: compErr } = await supabase
          .from('companies')
          .select('id, name')
          .in('id', companyIds);
        if (compErr) {
          console.error('Erro ao buscar empresas:', compErr);
          setCompanies([]);
          return;
        }
        setCompanies(companiesData ?? []);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Erro ao buscar empresas (catch):', err);
        setCompanies([]);
      } finally {
        setIsLoadingCompanies(false);
      }
    };
    const fetchAll = async () => {
      await fetchEmpresasDoUsuario();
      await fetchBookings();
    };
    fetchAll();
    return () => { cancelled = true; };
  }, []);

  const handleDeleteBooking = async (bookingId: string, bookingName: string) => {
    setIsDeletingId(bookingId);
    try {
      const { error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId);

      if (error) throw error;

      setBookings(prev => prev.filter(b => b.id !== bookingId));
      refreshBookingContext();
      toast({
        title: 'Reserva excluída',
        description: `A reserva "${bookingName}" foi excluída com sucesso.`,
      });
    } catch (error: any) {
      console.error('Delete error:', error);
      toast({
        title: 'Erro ao excluir',
        description: error.message || 'Não foi possível excluir a reserva.',
        variant: 'destructive',
      });
    } finally {
      setIsDeletingId(null);
    }
  };

  const handleExtractFromLink = async () => {
    if (!formData.url) {
      toast({
        title: 'URL obrigatória',
        description: 'Cole o link da reserva para extrair os dados automaticamente.',
        variant: 'destructive',
      });
      return;
    }

    setIsExtracting(true);
    setExtractedData(null);

    try {
      // Em alguns ambientes (principalmente produção), o invoke pode não enviar o JWT automaticamente.
      // Garantimos aqui o header Authorization para evitar 401 na Edge Function.
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      const authHeader = sessionData.session?.access_token
        ? { Authorization: `Bearer ${sessionData.session.access_token}` }
        : undefined;

      const url = formData.url.trim();

      // Para links do IDDAS, usamos a função específica (mais simples e sem dependências externas).
      // Para outros links, mantemos a função genérica.
      const isIddasLink = /agencia\.iddas\.com\.br\/reserva\//i.test(url);
      const functionName = isIddasLink ? 'extract-iddas-booking' : 'extract-booking-from-link';

      // Helper: try supabase.functions.invoke with retries, then fallback to direct fetch
      const invokeWithRetry = async (fnName: string, body: any, headers?: Record<string, string | undefined>, attempts = 3) => {
        let lastError: any = null;
        for (let i = 0; i < attempts; i++) {
          try {
            console.debug(`Invoking function ${fnName}, attempt ${i + 1}`);
            const res = await supabase.functions.invoke(fnName, { body, headers });
            // supabase returns { data, error }
            if ((res as any).error) throw (res as any).error;
            return (res as any).data;
          } catch (err) {
            console.warn(`Invoke attempt ${i + 1} failed for ${fnName}:`, err);
            lastError = err;
            // small backoff
            await new Promise(r => setTimeout(r, 200 * (i + 1)));
          }
        }

        // Fallback: try direct fetch to Functions HTTP endpoint
        try {
          const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${fnName}`;
          const fetchHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          // Prefer Authorization from session, otherwise use anon/publishable key
          if (headers?.Authorization) fetchHeaders.Authorization = headers.Authorization as string;
          else if (SUPABASE_KEY) fetchHeaders.apikey = SUPABASE_KEY;

          console.debug('Fallback fetch to', endpoint);
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: fetchHeaders,
            body: JSON.stringify(body),
          });

          const text = await resp.text();
          let parsed: any = null;
          try { parsed = JSON.parse(text); } catch (_) { parsed = text; }

          if (!resp.ok) {
            const err = new Error(`Function fetch failed with status ${resp.status}`);
            (err as any).status = resp.status;
            (err as any).body = parsed;
            throw err;
          }

          return parsed;
        } catch (fallbackErr) {
          (fallbackErr as any).original = lastError;
          throw fallbackErr;
        }
      };

      // invokeWithRetry returns the parsed response (or throws on network/fetch errors)
      const result = await invokeWithRetry(functionName, { url }, authHeader);

      if (import.meta.env.DEV) {
        console.log('[EXTRACT] raw result', result);
      }

      // Normalize payload from two possible shapes:
      // A) { success: true, data: { ... } }
      // B) { success: true, suggestedTitle, mainPassengerName, passengers?, flights?, hotels?, cars? }
      const payload: any = (result?.data?.data ?? result?.data) || result || {};

      if (import.meta.env.DEV) {
        console.log('[EXTRACT] payload', payload);
      }

      const success = (result?.data?.success === true) || (payload?.success === true) || (result?.success === true);

      const normalizeCpfDigits = (cpfRaw: any) => String(cpfRaw ?? '').replace(/\D/g, '');

      const looksLikeCompanyName = (nameRaw: any) => {
        const name = String(nameRaw ?? '').trim();
        if (!name) return false;
        const upper = name.toUpperCase();
        if (upper.startsWith('RESERVADO POR')) return true;

        const companyTokens = [
          'LTDA',
          'LTD',
          'EIRELI',
          'ME',
          'EPP',
          'S/A',
          'SA',
          'ADMINISTRACAO',
          'ADMINISTRAÇÃO',
          'HOLDING',
        ];
        return companyTokens.some((t) => upper.includes(t));
      };

      const getPassengerName = (p: any) => {
        const raw = p?.fullName ?? p?.full_name ?? p?.name ?? p?.nome ?? p?.passengerName ?? p?.passenger_name ?? '';
        return String(raw ?? '').replace(/^\s*(Reservado\s+por)\s+/i, '').trim();
      };

      const normalizePassengers = (rawPassengers: any[]) => {
        const out: any[] = [];
        const seen = new Set<string>();

        for (const p of rawPassengers || []) {
          const fullName = getPassengerName(p);
          const cpfDigits = normalizeCpfDigits(p?.cpf);

          // Ignora entradas vazias
          if (!fullName && !cpfDigits) continue;

          // Ignora empresa quando não há CPF válido
          if (looksLikeCompanyName(fullName) && cpfDigits.length !== 11) continue;

          const key = cpfDigits.length === 11 ? `cpf:${cpfDigits}` : `name:${fullName.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);

          out.push({
            ...p,
            fullName,
            name: p?.name ?? fullName,
            cpf: p?.cpf ?? cpfDigits,
          });
        }

        return out;
      };

      if (success) {
        // Prefer passengers[0].fullName as main passenger when available
        const passengersRaw: any[] = Array.isArray(payload.passengers) ? payload.passengers : Array.isArray(payload.passengers?.data) ? payload.passengers.data : [];
        const passengers = normalizePassengers(passengersRaw);
        const mainFromPassengers = passengers && passengers.length > 0 ? passengers[0].fullName : undefined;

        // Normalize payload to consistent keys expected by the UI and DB
        const normalized = {
          suggestedTitle: payload.suggestedTitle || payload.suggested_title || '',
          mainPassengerName: payload.mainPassengerName || payload.main_passenger_name || '',
          total: payload.total ?? null,
          flights: Array.isArray(payload.flights) ? payload.flights : [],
          passengers: passengers,
          hotels: Array.isArray(payload.hotels) ? payload.hotels : [],
          carRentals: Array.isArray(payload.carRentals)
            ? payload.carRentals
            : Array.isArray(payload.cars)
            ? payload.cars
            : [],
        } as any;

        setExtractedData(normalized);
        setFormData(prev => ({
          ...prev,
          title: normalized.suggestedTitle || prev.title,
          passengerName: (normalized.passengers && (normalized.passengers[0]?.fullName || normalized.passengers[0]?.name)) ?? mainFromPassengers ?? normalized.mainPassengerName ?? prev.passengerName,
        }));

        toast({
          title: 'Dados extraídos!',
          description: `Encontrado: ${ (normalized.flights || []).length || 0 } voo(s), ${ (normalized.hotels || []).length || 0 } hotel(is), ${ (normalized.carRentals || []).length || 0 } carro(s)`,
        });
      } else {
        // If the invoke/fetch returned an explicit error payload, show it. Otherwise don't show an error toast.
        const explicitError = result?.error || result?.data?.error || payload?.error;
        if (explicitError) {
          console.error('Extract function returned error:', explicitError);
          toast({
            title: 'Erro na extração',
            description: explicitError?.message || String(explicitError),
            variant: 'destructive',
          });
        } else {
          // No explicit error and no success flag — still accept partial payloads (e.g., only suggestedTitle)
          if (payload && Object.keys(payload).length > 0) {
            const passengersRaw: any[] = Array.isArray(payload.passengers) ? payload.passengers : Array.isArray(payload.passengers?.data) ? payload.passengers.data : [];
            const passengers = normalizePassengers(passengersRaw);
            const normalized = {
              suggestedTitle: payload.suggestedTitle || payload.suggested_title || '',
              mainPassengerName: payload.mainPassengerName || payload.main_passenger_name || '',
              total: payload.total ?? null,
              flights: Array.isArray(payload.flights) ? payload.flights : [],
              passengers: passengers,
              hotels: Array.isArray(payload.hotels) ? payload.hotels : [],
              carRentals: Array.isArray(payload.carRentals)
                ? payload.carRentals
                : Array.isArray(payload.cars)
                ? payload.cars
                : [],
            } as any;

            setExtractedData(normalized);
            setFormData(prev => ({
              ...prev,
              title: normalized.suggestedTitle || prev.title,
              passengerName: (normalized.passengers && (normalized.passengers[0]?.fullName || normalized.passengers[0]?.name)) ?? normalized.mainPassengerName ?? prev.passengerName,
            }));
          }
        }
      }
    } catch (error: any) {
      try {
        console.error('Extract error:', error);
        console.error('Extract error (full):', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        if ((error as any)?.body) {
          console.error('Extract error body:', (error as any).body);
        }
        if ((error as any)?.original) {
          console.error('Extract original error:', (error as any).original);
        }
      } catch (logErr) {
        console.error('Error while logging extract error details:', logErr);
      }
      toast({
        title: 'Erro',
        description: error.message || 'Erro ao extrair dados do link.',
        variant: 'destructive',
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.companyId) {
      toast({
        title: 'Empresa obrigatória',
        description: 'Selecione a empresa para esta reserva.',
        variant: 'destructive',
      });
      return;
    }

    if (!extractedData) {
      toast({
        title: 'Dados não extraídos',
        description: 'Cole o link e clique em Extrair para carregar os dados da reserva.',
        variant: 'destructive',
      });
      return;
    }

    const totalPaid = parseFloat(formData.totalPaid);
    const totalOriginal = parseFloat(formData.totalOriginal);

    if (isNaN(totalPaid) || totalPaid <= 0) {
      toast({
        title: 'Valor pago obrigatório',
        description: 'Informe o valor que foi pago pela reserva.',
        variant: 'destructive',
      });
      return;
    }

    if (isNaN(totalOriginal) || totalOriginal <= 0) {
      toast({
        title: 'Valor na cia obrigatório',
        description: 'Informe o valor que estaria na companhia aérea.',
        variant: 'destructive',
      });
      return;
    }

    
    try {
      const { data: userData } = await supabase.auth.getUser();
      // Passengers: garantir array de objetos com nome, cpf, etc
      const passengersToSave = (extractedData.passengers || []).map((p: any) => ({
        name: p.name || p.fullName || '',
        cpf: p.cpf,
        birthDate: p.birthDate,
        phone: p.phone,
        email: p.email,
        passport: p.passport,
      }));

      // Cria reserva com todos os dados extraídos (inclusive hotels, flights, car_rentals, passengers)
      const { data: insertedBooking, error } = await supabase
        .from('bookings')
        .insert({
          company_id: formData.companyId,
          name: formData.title || 'Nova Reserva',
          source_url: formData.url,
          flights: extractedData.flights || [],
          hotels: extractedData.hotels || [],
          car_rentals: extractedData.carRentals || [],
          passengers: passengersToSave,
          total_paid: totalPaid,
          total_original: totalOriginal,
          created_by: userData.user?.id,
        })
        .select('id')
        .single();

      if (error) throw error;

      // Auto-register employees if option is enabled and passengers were extracted
      let employeesCreated = 0;
      if (autoRegisterEmployees && passengersToSave?.length > 0) {
        for (const passenger of passengersToSave) {
          // Only require name, CPF and birth date - phone, email and passport are optional
          if (!passenger.name || !passenger.cpf || !passenger.birthDate) {
            continue; // Skip only if REQUIRED fields are missing
          }

          const cleanCpf = passenger.cpf.replace(/\D/g, '');
          if (cleanCpf.length !== 11) {
            console.warn('Invalid CPF length for passenger:', passenger.name);
            continue;
          }

          // Check if employee already exists by CPF
          const { data: existingEmployee } = await supabase
            .from('employees')
            .select('id')
            .eq('cpf', cleanCpf)
            .eq('company_id', formData.companyId)
            .maybeSingle();

          if (!existingEmployee) {
            // Use a default phone if not provided (required by DB)
            const phoneValue = passenger.phone?.replace(/\D/g, '') || '';
            
            const { error: empError } = await supabase.from('employees').insert({
              company_id: formData.companyId,
              full_name: passenger.name,
              cpf: cleanCpf,
              birth_date: passenger.birthDate,
              phone: phoneValue || 'Não informado',
              email: passenger.email || null,
              passport: passenger.passport || null,
              created_by: userData.user?.id,
            });

            if (!empError) {
              employeesCreated++;
            } else {
              console.warn('Error creating employee:', empError);
            }
          }
        }
      }

      const companyName = companies.find(c => c.id === formData.companyId)?.name || '';
      let descriptionMessage = `Reserva "${formData.title}" criada para ${companyName}.`;
      if (employeesCreated > 0) {
        descriptionMessage += ` ${employeesCreated} funcionário(s) cadastrado(s).`;
      }
      if (extractedData.hotels && extractedData.hotels.length > 0) {
        descriptionMessage += ` ${extractedData.hotels.length} hotel(is) adicionado(s).`;
      }

      toast({
        title: 'Reserva cadastrada!',
        description: descriptionMessage,
      });
      
      setOpen(false);
      setFormData({ companyId: '', url: '', title: '', passengerName: '', totalPaid: '', totalOriginal: '' });
      setExtractedData(null);
      setAutoRegisterEmployees(true);
      await fetchBookings();
      refreshBookingContext();
    } catch (error: any) {
      console.error('Submit error:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Erro ao salvar reserva.',
        variant: 'destructive',
      });
    }
  };

  // Mostra todas para admin, ou só da empresa do usuário
  const filteredBookings = bookings.filter(booking => {
    return booking.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const getCompanyName = (companyId?: string) => {
    if (!companyId) return '';
    return companies.find(c => c.id === companyId)?.name || '';
  };

  const getMainPassengerName = (booking: BookingFromDB) => {
    if (booking.flights && booking.flights.length > 0 && booking.flights[0].passengerName) {
      return booking.flights[0].passengerName;
    }
    if (booking.hotels && booking.hotels.length > 0 && booking.hotels[0].guestName) {
      return booking.hotels[0].guestName;
    }
    return '';
  };

  // Extrai as companhias aéreas de uma reserva
  const getAirlines = (booking: BookingFromDB): string[] => {
    if (!booking.flights || booking.flights.length === 0) return [];
    return booking.flights.map(f => f.airline).filter(Boolean);
  };

  // Extrai a data mais próxima da viagem
  const getTravelDate = (booking: BookingFromDB): string | null => {
    const dates: string[] = [];
    
    if (booking.flights?.length) {
      booking.flights.forEach(f => {
        if (f.departureDate) dates.push(f.departureDate);
      });
    }
    if (booking.hotels?.length) {
      booking.hotels.forEach(h => {
        if (h.checkIn) dates.push(h.checkIn);
      });
    }
    if (booking.car_rentals?.length) {
      booking.car_rentals.forEach(c => {
        if (c.pickupDate) dates.push(c.pickupDate);
      });
    }
    
    if (dates.length === 0) return null;
    
    // Ordenar por data mais próxima (formato DD/MM/YYYY)
    const sortedDates = dates.sort((a, b) => {
      const partsA = a.split('/');
      const partsB = b.split('/');
      const dateA = new Date(parseInt(partsA[2]), parseInt(partsA[1]) - 1, parseInt(partsA[0]));
      const dateB = new Date(parseInt(partsB[2]), parseInt(partsB[1]) - 1, parseInt(partsB[0]));
      return dateA.getTime() - dateB.getTime();
    });
    
    return sortedDates[0];
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Reservas</h2>
            <p className="text-muted-foreground">Todas as reservas consolidadas com voos, hotéis e carros</p>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center border rounded-lg p-1">
              <Button
                variant={viewMode === 'card' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('card')}
                className="h-8 px-3"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'landscape' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('landscape')}
                className="h-8 px-3"
              >
                <LayoutList className="h-4 w-4" />
              </Button>
            </div>
            
            {isAdmin && (
              <Dialog open={open} onOpenChange={(o) => {
                setOpen(o);
                if (!o) {
                  setFormData({ companyId: '', url: '', title: '', passengerName: '', totalPaid: '', totalOriginal: '' });
                  setExtractedData(null);
                }
              }}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Nova Reserva
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Cadastrar Reserva via Link</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Company Selection */}
                    <div className="space-y-2">
                      <Label htmlFor="company">Empresa *</Label>
                      <Select
                        value={formData.companyId}
                        onValueChange={(value) => setFormData({ ...formData, companyId: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          {isLoadingCompanies ? (
                            <SelectItem value="loading" disabled>Carregando...</SelectItem>
                          ) : companies.length === 0 ? (
                            <SelectItem value="none" disabled>Nenhuma empresa cadastrada</SelectItem>
                          ) : (
                            companies.map(company => (
                              <SelectItem key={company.id} value={company.id}>
                                {company.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Link Input */}
                    <div className="space-y-2">
                      <Label htmlFor="url">Link da Reserva *</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Link className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="url"
                            value={formData.url}
                            onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                            placeholder="Cole o link da agência de viagens"
                            className="pl-10"
                          />
                        </div>
                        <Button 
                          type="button" 
                          onClick={handleExtractFromLink}
                          disabled={isExtracting || !formData.url}
                        >
                          {isExtracting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Extraindo...
                            </>
                          ) : (
                            'Extrair'
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Cole o link e clique em Extrair. O sistema identificará automaticamente voos, hotéis e carros.
                      </p>
                    </div>

                    {/* Extracted Data Preview */}
                    {extractedData && (
                      <Card className="bg-muted/50">
                        <CardHeader className="py-3">
                          <CardTitle className="text-sm">Dados Extraídos</CardTitle>
                        </CardHeader>
                        <CardContent className="py-2 space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {extractedData.flights?.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                                <Plane className="h-3 w-3" /> {extractedData.flights.length} voo(s)
                              </span>
                            )}
                            {extractedData.hotels?.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs bg-secondary/10 text-secondary px-2 py-1 rounded-full">
                                <Building2 className="h-3 w-3" /> {extractedData.hotels.length} hotel(is)
                              </span>
                            )}
                            {extractedData.carRentals?.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs bg-chart-5/10 text-chart-5 px-2 py-1 rounded-full">
                                <Car className="h-3 w-3" /> {extractedData.carRentals.length} carro(s)
                              </span>
                            )}
                            {extractedData.passengers?.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs bg-accent/20 text-accent-foreground px-2 py-1 rounded-full">
                                <Users className="h-3 w-3" /> {extractedData.passengers.length} passageiro(s)
                              </span>
                            )}
                          </div>
                          
                          {extractedData.flights?.length > 0 && (
                            <div className="text-xs space-y-1 mt-2">
                              {extractedData.flights.map((f: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-muted-foreground">
                                  <Plane className="h-3 w-3" />
                                  <span>{f.airline} {f.flightNumber}: {f.origin} → {f.destination} ({f.departureDate})</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Hotels Preview */}
                          {extractedData.hotels?.length > 0 && (
                            <div className="border-t pt-3 mt-2">
                              <div className="text-xs font-medium text-foreground mb-2">Hospedagem Identificada</div>
                              <div className="space-y-2">
                                {extractedData.hotels.map((h: any, idx: number) => (
                                  <div key={idx} className="p-2 rounded border bg-background/50 text-sm">
                                    <div className="font-medium">{h.hotelName || h.name}</div>
                                    <div className="text-muted-foreground text-xs mt-1">{h.city || ''}</div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
                                      <div>Check-in: {h.checkIn || h.check_in || '-'}</div>
                                      <div>Check-out: {h.checkOut || h.check_out || '-'}</div>
                                    </div>
                                    {h.confirmationCode && (
                                      <div className="text-xs text-muted-foreground mt-1">Código: {h.confirmationCode}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Car Rentals Preview */}
                          {extractedData.carRentals?.length > 0 && (
                            <div className="border-t pt-3 mt-2">
                              <div className="text-xs font-medium text-foreground mb-2">Aluguel de Carro Identificado</div>
                              <div className="space-y-2">
                                {extractedData.carRentals.map((c: any, idx: number) => (
                                  <div key={idx} className="p-2 rounded border bg-background/50 text-sm">
                                    <div className="font-medium">{c.company || c.locadora || 'Locadora'}</div>
                                    <div className="text-muted-foreground text-xs mt-1">Retirada: {c.pickupDateTime || c.pickupDate || '-'}</div>
                                    <div className="text-muted-foreground text-xs">Devolução: {c.dropoffDateTime || c.returnDate || '-'}</div>
                                    {c.confirmationCode && (
                                      <div className="text-xs text-muted-foreground mt-1">Código: {c.confirmationCode}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Passengers Preview */}
                          {extractedData.passengers?.length > 0 && (
                            <div className="border-t pt-3 mt-2">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-foreground flex items-center gap-1">
                                  <Users className="h-3 w-3" /> Passageiros Identificados
                                </span>
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={autoRegisterEmployees}
                                    onChange={(e) => setAutoRegisterEmployees(e.target.checked)}
                                    className="h-3 w-3 rounded border-input"
                                  />
                                  <span className="text-muted-foreground">Cadastrar automaticamente</span>
                                </label>
                              </div>
                              <div className="space-y-1">
                                {extractedData.passengers.map((p: any, i: number) => (
                                  <div key={i} className="text-xs bg-background/50 p-2 rounded border">
                                    <div className="font-medium text-foreground">{(p.fullName || p.name || '').trim() ? (p.fullName || p.name) : 'Nome não identificado'}</div>
                                    <div className="text-muted-foreground flex flex-wrap gap-2 mt-1">
                                      {p.cpf && <span>CPF: {p.cpf}</span>}
                                      {p.birthDate && <span>Nasc: {new Date(p.birthDate).toLocaleDateString('pt-BR')}</span>}
                                      {p.phone && <span>Tel: {p.phone}</span>}
                                      {p.email && <span>{p.email}</span>}
                                      {p.passport && <span>Passaporte: {p.passport}</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="title">Título da Reserva</Label>
                      <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        placeholder="Ex: Viagem a São Paulo - Dezembro 2025"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="passengerName">Nome do Passageiro Principal</Label>
                      <Input
                        id="passengerName"
                        value={formData.passengerName}
                        onChange={(e) => setFormData({ ...formData, passengerName: e.target.value })}
                        placeholder="Nome completo"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="totalPaid">Valor Pago (R$) *</Label>
                        <Input
                          id="totalPaid"
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.totalPaid}
                          onChange={(e) => setFormData({ ...formData, totalPaid: e.target.value })}
                          placeholder="0,00"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="totalOriginal">Valor na Cia (R$) *</Label>
                        <Input
                          id="totalOriginal"
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.totalOriginal}
                          onChange={(e) => setFormData({ ...formData, totalOriginal: e.target.value })}
                          placeholder="0,00"
                          required
                        />
                      </div>
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={!extractedData || !formData.companyId || !formData.totalPaid || !formData.totalOriginal}
                    >
                      Criar Reserva
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título da reserva..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Loading State */}
        {isLoadingBookings ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Carregando reservas...</p>
          </div>
        ) : filteredBookings.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchTerm 
                ? 'Nenhuma reserva encontrada com os filtros aplicados.' 
                : 'Nenhuma reserva cadastrada ainda.'}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Crie uma reserva via link para cadastrar automaticamente.
            </p>
          </div>
        ) : (
          <div className={viewMode === 'landscape' ? 'space-y-3' : 'space-y-6'}>
            {filteredBookings.map((booking) => {

              const airlines = getAirlines(booking);
              const travelDate = getTravelDate(booking);
              
              if (viewMode === 'landscape') {
                // Modo Lista - Compacto
                return (
                  <Card key={booking.id} className="overflow-hidden">
                    <div className="flex items-center gap-4 p-4">
                      {/* Ícone/Logo da Cia Aérea */}
                      <div className="flex-shrink-0">
                        {airlines.length > 0 ? (
                          <AirlineLogos airlines={airlines} />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Package className="h-5 w-5 text-primary" />
                          </div>
                        )}
                      </div>
                      
                      {/* Informações Principais */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">{booking.name}</h3>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
                          <span className="font-medium text-foreground">{getCompanyName(booking.company_id)}</span>
                          {travelDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {travelDate}
                            </span>
                          )}
                        </div>

                        {/* Hotel vinculado */}
                        {booking.hotels && booking.hotels.length > 0 && (
                          <div className="text-sm text-muted-foreground mt-1">
                            <span className="font-medium">Hotel: </span>
                            {(() => {
                              const hotel = booking.hotels[0];
                              const name = hotel?.hotelName;
                              const checkIn = hotel?.checkIn;
                              const checkOut = hotel?.checkOut;
                              if (hotel && name) return `${name}${checkIn ? ` (${checkIn}` : ''}${checkOut ? ` - ${checkOut})` : (checkIn ? ')' : '')}`;
                              if (hotel && !name) return 'Não informado';
                              return null;
                            })()}
                          </div>
                        )}

                        {/* Passengers short list */}
                        <div className="text-sm text-muted-foreground mt-1">
                          <span className="font-medium">Passageiros: </span>
                          {(() => {
                            const names: string[] = [];
                            // Use booking.passengers if available (stored in DB), otherwise fallback to flights/hotels
                            if (Array.isArray(booking.passengers) && booking.passengers.length > 0) {
                              for (const p of booking.passengers) if (p.name) names.push(p.name);
                            } else {
                              // Fallback: derive from flights
                              if (Array.isArray(booking.flights)) {
                                for (const f of booking.flights) if (f.passengerName) names.push(f.passengerName);
                              }
                              // If still empty, try hotels
                              if (names.length === 0 && Array.isArray(booking.hotels)) {
                                for (const h of booking.hotels) if ((h as any).guestName) names.push((h as any).guestName);
                              }
                            }
                            const display = names.slice(0, 3);
                            const rest = Math.max(0, names.length - display.length);
                            return (
                              <>
                                {display.join(', ')}{rest > 0 ? ` +${rest}` : ''}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      
                      {/* Badges dos itens */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {booking.flights && booking.flights.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                            <Plane className="h-3 w-3" /> {booking.flights.length}
                          </span>
                        )}
                        {booking.hotels && booking.hotels.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-secondary/10 text-secondary px-2 py-0.5 rounded-full">
                            <Building2 className="h-3 w-3" /> {booking.hotels.length}
                          </span>
                        )}
                        {booking.car_rentals && booking.car_rentals.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs bg-chart-5/10 text-chart-5 px-2 py-0.5 rounded-full">
                            <Car className="h-3 w-3" /> {booking.car_rentals.length}
                          </span>
                        )}
                      </div>
                      
                      {/* Economia */}
                      <div className="flex-shrink-0">
                        <SavingsCard 
                          pricePaid={booking.total_paid || 0} 
                          priceOriginal={booking.total_original || 0} 
                        />
                      </div>
                      
                      <Button
                        variant="outline"
                        onClick={() => navigate(`/reservas/${booking.id}`)}
                      >
                        Abrir reserva
                      </Button>

                      {/* Botão Excluir */}
                      {isAdmin && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                              disabled={isDeletingId === booking.id}
                            >
                              {isDeletingId === booking.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir reserva</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir a reserva "{booking.name}"? Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteBooking(booking.id, booking.name)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </Card>
                );
              }
              
              // Modo Card - Completo
                                        {/* Hotel vinculado */}
                                        {booking.hotels && booking.hotels.length > 0 && (
                                          <div className="text-sm text-muted-foreground mt-1">
                                            <span className="font-medium">Hotel: </span>
                                            {(() => {
                                              const hotel = booking.hotels[0];
                                              const name = hotel?.hotelName;
                                              if (hotel && name) return name;
                                              if (hotel && !name) return 'Não informado';
                                              return null;
                                            })()}
                                          </div>
                                        )}
              return (
                <Card key={booking.id}>
                  <CardHeader className="bg-primary/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Logo/Ícone da Cia Aérea ou Package */}
                        {airlines.length > 0 ? (
                          <AirlineLogos airlines={airlines} />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Package className="h-5 w-5 text-primary" />
                          </div>
                        )}
                        <div>
                          <CardTitle className="text-lg">{booking.name}</CardTitle>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1 flex-wrap">
                            <span className="font-medium text-foreground">{getCompanyName(booking.company_id)}</span>
                            {travelDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {travelDate}
                              </span>
                            )}
                          </div>

                          <div className="text-sm text-muted-foreground mt-2">
                            <span className="font-medium">Passageiros: </span>
                            {(() => {
                              const names: string[] = [];
                              if (Array.isArray(booking.flights)) {
                                for (const f of booking.flights) if (f.passengerName) names.push(f.passengerName);
                              }
                              if (names.length === 0 && Array.isArray(booking.hotels)) {
                                for (const h of booking.hotels) if ((h as any).guestName) names.push((h as any).guestName);
                              }
                              const display = names.slice(0, 3);
                              const rest = Math.max(0, names.length - display.length);
                              return (
                                <>
                                  {display.join(', ')}{rest > 0 ? ` +${rest}` : ''}
                                </>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            {booking.flights && booking.flights.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                <Plane className="h-3 w-3" /> {booking.flights.length} voo(s)
                              </span>
                            )}
                            {booking.hotels && booking.hotels.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs bg-secondary/10 text-secondary px-2 py-0.5 rounded-full">
                                <Building2 className="h-3 w-3" /> {booking.hotels.length} hotel(s)
                              </span>
                            )}
                            {booking.car_rentals && booking.car_rentals.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs bg-chart-5/10 text-chart-5 px-2 py-0.5 rounded-full">
                                <Car className="h-3 w-3" /> {booking.car_rentals.length} carro(s)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <SavingsCard 
                          pricePaid={booking.total_paid || 0} 
                          priceOriginal={booking.total_original || 0} 
                          />

                           <Button
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(`/reservas/${booking.id}`)}
                            >
                              Abrir reserva
                            </Button>
                          
                        {isAdmin && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={isDeletingId === booking.id}
                              >
                                {isDeletingId === booking.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Excluir reserva</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Tem certeza que deseja excluir a reserva "{booking.name}"? Esta ação não pode ser desfeita.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteBooking(booking.id, booking.name)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Excluir
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                <CardContent className="pt-4">
                  <Accordion type="multiple" className="w-full">
                    {booking.flights && booking.flights.length > 0 && (
                      <AccordionItem value="flights">
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-2">
                            <Plane className="h-4 w-4 text-primary" />
                            <span>Voos ({booking.flights.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="grid grid-cols-1 gap-4 pt-2">
                            {booking.flights.map((flight, idx) => (
                              <FlightCard key={flight.id || idx} flight={flight} showSavings={false} viewMode="card" />
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                    
                    {booking.hotels && booking.hotels.length > 0 && (
                      <AccordionItem value="hotels">
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-secondary" />
                            <span>Hospedagens ({booking.hotels.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="grid grid-cols-1 gap-4 pt-2">
                            {booking.hotels.map((hotel, idx) => (
                              <HotelCard key={hotel.id || idx} hotel={hotel} showSavings={false} viewMode="card" />
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                    
                    {booking.car_rentals && booking.car_rentals.length > 0 && (
                      <AccordionItem value="cars">
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-2">
                            <Car className="h-4 w-4 text-chart-5" />
                            <span>Aluguel de Carro ({booking.car_rentals.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="grid grid-cols-1 gap-4 pt-2">
                            {booking.car_rentals.map((car, idx) => (
                              <CarRentalCard key={car.id || idx} carRental={car} showSavings={false} viewMode="card" />
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </Accordion>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
