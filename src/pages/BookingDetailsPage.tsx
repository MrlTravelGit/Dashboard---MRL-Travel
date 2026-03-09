import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HotelCard } from '@/components/cards/HotelCard';
import { CarRentalCard } from '@/components/cards/CarRentalCard';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, ExternalLink, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { invokeWithAuth } from "@/integrations/supabase/invokeWithAuth";

type BookingRow = {
  id: string;
  name: string;
  company_id: string;
  source_url: string | null;
  total_paid: number | null;
  total_original: number | null;
  created_at: string;
  flights?: any[];
  hotels?: any[];
  car_rentals?: any[];
  passengers?: any[];
};

export default function BookingDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [registeringEmployees, setRegisteringEmployees] = useState(false);
  const [booking, setBooking] = useState<BookingRow | null>(null);

  const [form, setForm] = useState({
    name: "",
    totalPaid: "",
    totalOriginal: "",
  });

  useEffect(() => {
    const load = async () => {
      if (!id) return;

      setLoading(true);
      const { data, error } = await supabase
        .from("bookings")
        .select("id,name,company_id,source_url,total_paid,total_original,created_at,flights,hotels,car_rentals,passengers" as any)
        .eq("id", id)
        .single();

      if (error) {
        toast({
          title: "Erro ao carregar reserva",
          description: error.message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const b = data as unknown as BookingRow;
      setBooking(b);

      setForm({
        name: b.name || "",
        totalPaid: b.total_paid != null ? String(b.total_paid) : "",
        totalOriginal: b.total_original != null ? String(b.total_original) : "",
      });

      setLoading(false);
    };

    load();
  }, [id, toast]);


  const normalizeCpfDigits = (cpf?: string) => (cpf || '').replace(/\D/g, '');

  const toISODate = (value: any): string | null => {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) {
      const dd = m[1];
      const mm = m[2];
      const yyyy = m[3];
      return `${yyyy}-${mm}-${dd}`;
    }

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  };

  const handleRegisterEmployeesFromBooking = async () => {
    if (!booking?.company_id) return;
    const passengers = Array.isArray(booking.passengers) ? booking.passengers : [];
    if (passengers.length === 0) return;

    setRegisteringEmployees(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const createdBy = userRes?.user?.id ?? null;

      const unique = new Map<string, any>();

      passengers.forEach((p: any) => {
        const cpf = normalizeCpfDigits(p?.cpf || '');
        const full_name = String(p?.name || '').trim();
        if (!cpf || cpf.length !== 11 || !full_name) return;

        const birth_date = toISODate(p?.birth_date || p?.birthDate || p?.nasc);
        const phone = String(p?.phone || p?.tel || '').trim() || '';
        const email = String(p?.email || '').trim() || null;

        const key = `${booking.company_id}:${cpf}`;
        if (!unique.has(key)) {
          unique.set(key, {
            company_id: booking.company_id,
            cpf,
            full_name,
            birth_date,
            phone,
            email,
            created_by: createdBy,
          });
        }
      });

      const payload = Array.from(unique.values());
      if (payload.length === 0) {
        toast({ title: "Nada para cadastrar", description: "Nenhum passageiro válido encontrado para cadastrar como funcionário." });
        return;
      }

      const cpfs = payload.map((p) => p.cpf);
      const { data: existing, error: existingErr } = await supabase
        .from("employees")
        .select("id, cpf")
        .eq("company_id", booking.company_id)
        .in("cpf", cpfs);

      if (existingErr) throw existingErr;

      const existingSet = new Set((existing || []).map((e: any) => normalizeCpfDigits(e.cpf)));
      const toInsert = payload.filter((p) => !existingSet.has(normalizeCpfDigits(p.cpf)));

      if (toInsert.length === 0) {
        toast({ title: "Funcionários já cadastrados", description: "Todos os passageiros desta reserva já estão na aba de funcionários." });
        return;
      }

      const tryInsert = async (rows: any[]) => {
        const { data: inserted, error: insErr } = await supabase
          .from("employees")
          .insert(rows)
          .select("id");
        if (insErr) throw insErr;
        return inserted?.length ?? 0;
      };

      let createdCount = 0;

      try {
        createdCount = await tryInsert(toInsert.map((r) => ({ ...r, birth_date: r.birth_date ?? null })));
      } catch (insertErr: any) {
        const withBirthDate = toInsert.filter((p: any) => !!p.birth_date);
        const withoutBirthDate = toInsert.filter((p: any) => !p.birth_date);

        if (withBirthDate.length > 0) {
          createdCount = await tryInsert(withBirthDate);
        } else {
          throw insertErr;
        }

        if (withoutBirthDate.length > 0) {
          toast({
            title: "Alguns funcionários não foram cadastrados",
            description: "Alguns passageiros não têm data de nascimento. Preencha a data de nascimento para cadastrar automaticamente.",
            variant: "destructive",
          });
        }
      }

      toast({
        title: "Funcionários cadastrados",
        description: `${createdCount} funcionário(s) cadastrado(s) a partir desta reserva.`,
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Erro ao cadastrar funcionários",
        description: e?.message || "Não foi possível cadastrar funcionários.",
        variant: "destructive",
      });
    } finally {
      setRegisteringEmployees(false);
    }
  };

  const parseOptionalNumber = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isNaN(n)) return undefined;
    return n;
  };

  const handleSave = async () => {
    if (!id) return;

    if (!isAdmin) {
      toast({
        title: "Ação não permitida",
        description: "Somente o administrador pode editar esta reserva.",
        variant: "destructive",
      });
      return;
    }

    let totalPaid: number | null | undefined = null;
    let totalOriginal: number | null | undefined = null;

    if (isAdmin) {
      totalPaid = parseOptionalNumber(form.totalPaid);
      if (totalPaid === undefined) {
        toast({
          title: "Valor pago inválido",
          description: "Digite um número ou deixe em branco.",
          variant: "destructive",
        });
        return;
      }

      totalOriginal = parseOptionalNumber(form.totalOriginal);
      if (totalOriginal === undefined) {
        toast({
          title: "Valor na cia inválido",
          description: "Digite um número ou deixe em branco.",
          variant: "destructive",
        });
        return;
      }
    }

    const updatePayload: any = {
      name: form.name || "Reserva",
    };

    if (isAdmin) {
      updatePayload.total_paid = totalPaid;
      updatePayload.total_original = totalOriginal;
    }

    setSaving(true);

    const { error } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", id);

    if (error) {
      toast({
        title: "Erro ao salvar",
        description: error.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    toast({
      title: "Reserva atualizada",
      description: "Alterações salvas com sucesso.",
    });

    setSaving(false);
  };

  const handleImportFromLink = async () => {
    if (!booking?.source_url) {
      toast({
        title: "Sem link",
        description: "Esta reserva não tem link salvo.",
        variant: "destructive",
      });
      return;
    }

    setImporting(true);
    try {
      const url = booking.source_url;
      const isIddasLink = /agencia\.iddas\.com\.br\/reserva\//i.test(url);
      const functionName = isIddasLink ? "extract-iddas-booking" : "extract-booking-from-link";

      const { data, error } = await invokeWithAuth(functionName, {
        body: { url },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Falha ao importar dados");

      if ((data as any)?.debug) {
        console.warn('[IMPORT] debug', (data as any).debug);
      }

      const extracted = data.data;

      const total = extracted.total ?? null;

      const updatePayload: any = {
        name: extracted.suggestedTitle || booking.name,
      };

      if (isAdmin) {
        updatePayload.total_paid = total;
        updatePayload.total_original = total;
      }

      if (Array.isArray(extracted.flights)) {
        updatePayload.flights = extracted.flights;
      }

      if (Array.isArray(extracted.hotels)) {
        updatePayload.hotels = extracted.hotels;
      }

      if (Array.isArray(extracted.carRentals)) {
        updatePayload.car_rentals = extracted.carRentals;
      }

      if (Array.isArray(extracted.passengers)) {
        updatePayload.passengers = extracted.passengers;
      }

      const { error: upErr } = await supabase
        .from("bookings")
        .update(updatePayload)
        .eq("id", booking.id);

      if (upErr) throw upErr;

      setBooking((prev) => (prev ? { ...prev, ...updatePayload } : prev));
      setForm((prev) => ({
        ...prev,
        name: updatePayload.name || "",
        totalPaid: updatePayload.total_paid != null ? String(updatePayload.total_paid) : prev.totalPaid,
        totalOriginal: updatePayload.total_original != null ? String(updatePayload.total_original) : prev.totalOriginal,
      }));

      toast({
        title: "Importado do link",
        description: "Dados preenchidos e salvos na reserva.",
      });
    } catch (e: any) {
      toast({
        title: "Erro ao importar",
        description: e.message || "Não foi possível importar os dados do link.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/reservas")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar
            </Button>
            <h2 className="text-2xl font-bold">Detalhe da reserva</h2>
          </div>

          {booking?.source_url ? (
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <Button variant="outline" onClick={handleImportFromLink} disabled={importing}>
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importando...
                    </>
                  ) : (
                    "Importar do link"
                  )}
                </Button>
              ) : null}

              <Button
                variant="secondary"
                onClick={() => window.open(booking.source_url as string, "_blank")}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Abrir link
              </Button>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
            <div className="text-muted-foreground">Carregando reserva...</div>
          </div>
        ) : !booking ? (
          <div className="py-10 text-center text-muted-foreground">
            Reserva não encontrada.
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{booking.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Ex: Reserva (link salvo)"
                  disabled={!isAdmin}
                />
              </div>

              {booking.hotels && booking.hotels.length > 0 && (
                <div className="space-y-2">
                  <Label>Hotel vinculado</Label>
                  <div className="text-sm text-muted-foreground">
                    {(() => {
                      const hotel = booking.hotels[0];
                      const name = hotel?.hotelName || hotel?.name || hotel?.hotel_name;
                      if (hotel && name) return name;
                      if (hotel && !name) return 'Não informado';
                      return null;
                    })()}
                  </div>
                </div>
              )}

              {isAdmin ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Valor pago (R$)</Label>
                    <Input
                      value={form.totalPaid}
                      onChange={(e) => setForm((p) => ({ ...p, totalPaid: e.target.value }))}
                      placeholder="Deixe em branco se ainda não souber"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Valor na cia (R$)</Label>
                    <Input
                      value={form.totalOriginal}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, totalOriginal: e.target.value }))
                      }
                      placeholder="Deixe em branco se ainda não souber"
                    />
                  </div>
                </div>
              ) : null}

              {booking.source_url ? (
                <div className="space-y-2">
                  <Label>Link salvo</Label>
                  <div className="text-sm break-all text-muted-foreground">
                    {booking.source_url}
                  </div>
                </div>
              ) : null}

              {isAdmin ? (
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    "Salvar"
                  )}
                </Button>
              ) : null}

              {/* Passengers Section (from booking.passengers array) */}
              {booking?.passengers && booking.passengers.length > 0 ? (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-3">
                    <CardTitle>Passageiros</CardTitle>
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRegisterEmployeesFromBooking}
                        disabled={registeringEmployees || !(booking?.passengers && booking.passengers.length > 0)}
                      >
                        {registeringEmployees ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Cadastrando...
                          </>
                        ) : (
                          <>
                            <Users className="h-4 w-4 mr-2" />
                            Cadastrar em Funcionários
                          </>
                        )}
                      </Button>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {booking.passengers.map((p: any, idx: number) => (
                        <div key={`${p.name}-${p.cpf || idx}`} className="p-3 rounded border bg-background/50 space-y-1">
                          <div className="font-medium">{p.name}</div>
                          {p.cpf && <div className="text-xs text-muted-foreground">CPF: {p.cpf}</div>}
                          {p.birthDate && <div className="text-xs text-muted-foreground">Nasc: {p.birthDate}</div>}
                          {p.phone && <div className="text-xs text-muted-foreground">Tel: {p.phone}</div>}
                          {p.email && <div className="text-xs text-muted-foreground">Email: {p.email}</div>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* Hotels Section */}
              {booking?.hotels && booking.hotels.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Hospedagem</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-4">
                      {booking.hotels.map((h: any) => (
                        <HotelCard key={h.id || h.locator || Math.random()} hotel={h} onDelete={isAdmin ? undefined : undefined} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* Car Rentals Section */}
              {booking?.car_rentals && booking.car_rentals.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Aluguel de carro</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-4">
                      {booking.car_rentals.map((c: any) => (
                        <CarRentalCard key={c.id || c.locator || Math.random()} carRental={c} onDelete={isAdmin ? undefined : undefined} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
