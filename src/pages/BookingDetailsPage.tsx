import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HotelCard } from '@/components/cards/HotelCard';
import { CarRentalCard } from '@/components/cards/CarRentalCard';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
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
  const [booking, setBooking] = useState<BookingRow | null>(null);

  const [registeringEmployees, setRegisteringEmployees] = useState(false);

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


  const handleRegisterEmployeesFromBooking = async () => {
    if (!booking) return;

    setRegisteringEmployees(true);

    try {
      const companyId = booking.company_id;
      const passengers = Array.isArray(booking.passengers) ? booking.passengers : [];

      const { data: userRes } = await supabase.auth.getUser();
      const createdBy = userRes?.user?.id ?? null;

      const normalizeCpfDigits = (v: any) => String(v || '').replace(/\D/g, '');

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

      const unique = new Map<string, any>();
      let skippedMissing = 0;

      for (const p of passengers) {
        const cpf = normalizeCpfDigits((p as any)?.cpf);
        const full_name = String((p as any)?.name || (p as any)?.full_name || (p as any)?.fullName || '').trim();
        const birth_date = toISODate((p as any)?.birth_date || (p as any)?.birthDate || (p as any)?.nasc);
        const phoneRaw = String((p as any)?.phone || (p as any)?.tel || '').trim();
        const email = String((p as any)?.email || '').trim() || null;
        const passport = String((p as any)?.passport || '').trim() || null;
        const passport_expiry = toISODate((p as any)?.passport_expiry || (p as any)?.passportExpiry);

        if (!cpf || cpf.length !== 11 || !full_name || !birth_date) {
          skippedMissing += 1;
          continue;
        }

        const key = `${companyId}:${cpf}`;
        const base = {
          company_id: companyId,
          cpf,
          full_name,
          birth_date,
          phone: (phoneRaw || '').toString(),
          email,
          passport,
          passport_expiry,
          created_by: createdBy,
        };

        if (!unique.has(key)) {
          unique.set(key, base);
        } else {
          const prev = unique.get(key);
          if (!prev.phone && base.phone) prev.phone = base.phone;
          if (!prev.email && base.email) prev.email = base.email;
          if (!prev.passport && base.passport) prev.passport = base.passport;
          if (!prev.passport_expiry && base.passport_expiry) prev.passport_expiry = base.passport_expiry;
          if (base.full_name) prev.full_name = base.full_name;
        }
      }

      const payload = Array.from(unique.values());

      if (payload.length === 0) {
        toast({
          title: 'Nada para cadastrar',
          description: skippedMissing
            ? `Nenhum passageiro elegível. ${skippedMissing} item(ns) foi(ram) ignorado(s) por falta de CPF, nome ou nascimento.`
            : 'Nenhum passageiro elegível encontrado nesta reserva.',
          variant: 'destructive',
        });
        return;
      }

      const cpfList = payload.map((x) => normalizeCpfDigits(x.cpf));

      const { data: existing, error: existingErr } = await supabase
        .from('employees')
        .select('id, cpf, full_name, birth_date, phone, email, passport, passport_expiry')
        .eq('company_id', companyId)
        .in('cpf', cpfList);

      if (existingErr) throw existingErr;

      const existingMap = new Map<string, any>();
      for (const e of existing || []) {
        existingMap.set(normalizeCpfDigits((e as any)?.cpf), e);
      }

      const toInsert: any[] = [];
      const toUpdate: any[] = [];

      for (const row of payload) {
        const cpf = normalizeCpfDigits(row.cpf);
        const found = existingMap.get(cpf);

        if (!found) {
          toInsert.push(row);
          continue;
        }

        const patch: any = {};

        const existingName = String((found as any)?.full_name || '').trim();
        if (
          row.full_name &&
          (
            !existingName ||
            /@|hotmail\.com|gmail\.com/i.test(existingName) ||
            /^crian[cç]a\s+/i.test(existingName)
          )
        ) {
          patch.full_name = row.full_name;
        }

        if (!(found as any)?.birth_date && row.birth_date) patch.birth_date = row.birth_date;
        if ((!((found as any)?.phone || '').toString().trim()) && row.phone) patch.phone = row.phone;
        if (!(found as any)?.email && row.email) patch.email = row.email;
        if (!(found as any)?.passport && row.passport) patch.passport = row.passport;
        if (!(found as any)?.passport_expiry && row.passport_expiry) patch.passport_expiry = row.passport_expiry;

        if (Object.keys(patch).length > 0) {
          toUpdate.push({ id: (found as any).id, patch });
        }
      }

      let insertedCount = 0;
      let updatedCount = 0;
      const alreadyCount = payload.length - toInsert.length;

      if (toInsert.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from('employees')
          .insert(toInsert)
          .select('id');

        if (insErr) throw insErr;
        insertedCount = inserted?.length ?? 0;
      }

      for (const u of toUpdate) {
        const { error: updErr } = await supabase
          .from('employees')
          .update(u.patch)
          .eq('id', u.id);

        if (updErr) throw updErr;
        updatedCount += 1;
      }

      const parts: string[] = [];
      if (insertedCount > 0) parts.push(`${insertedCount} cadastrado(s)`);
      if (updatedCount > 0) parts.push(`${updatedCount} atualizado(s)`);
      if (alreadyCount > 0) parts.push(`${alreadyCount} já existia(m)`);
      if (skippedMissing > 0) parts.push(`${skippedMissing} ignorado(s) por falta de dados`);

      toast({
        title: 'Funcionários processados',
        description: parts.length ? `${parts.join('. ')}.` : 'Nenhuma alteração necessária.',
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Erro ao cadastrar funcionários',
        description: e?.message || 'Não foi possível cadastrar funcionários desta reserva.',
        variant: 'destructive',
      });
    } finally {
      setRegisteringEmployees(false);
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
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle>Passageiros</CardTitle>
                    {isAdmin ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRegisterEmployeesFromBooking}
                        disabled={registeringEmployees}
                      >
                        {registeringEmployees ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Cadastrando...
                          </>
                        ) : (
                          "Cadastrar funcionários desta reserva"
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
