/**
 * src/utils/bookingUtils.ts
 * Utilitários de data e status de reserva.
 * Usado por BookingsPage. Não altera outros arquivos.
 */

// ─── Parsing de datas ──────────────────────────────────────────────────────────

/**
 * Converte DD/MM/YYYY ou YYYY-MM-DD para Date local (sem fuso).
 * Retorna null se não reconhecer o formato.
 */
export function parseTravelDate(raw: string | null | undefined): Date | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // DD/MM/YYYY
  const brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const [, dd, mm, yyyy] = brMatch.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  return null;
}

/** Retorna true se a data (sem hora) já passou em relação à meia-noite de hoje. */
export function isDatePast(d: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

/** Retorna true se a data ainda não chegou (futuro). */
export function isDateFuture(d: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d >= today;
}

// ─── Status de reserva ─────────────────────────────────────────────────────────

export type BookingStatus = 'upcoming' | 'completed' | 'partial' | 'unknown';

interface RawBooking {
  flights?: Array<{ departureDate?: string; arrivalDate?: string }> | null;
  hotels?: Array<{ checkIn?: string; check_in?: string; checkOut?: string; check_out?: string }> | null;
  car_rentals?: Array<{ pickupDate?: string; returnDate?: string }> | null;
}

/**
 * Calcula o status de uma reserva com base nas datas dos itens.
 * - 'upcoming': todos os itens com datas são futuros
 * - 'completed': todos os itens com datas já passaram
 * - 'partial': mistura (alguns futuros, alguns passados)
 * - 'unknown': nenhum item com data reconhecível
 */
export function computeBookingStatus(booking: RawBooking): BookingStatus {
  const itemStatuses: boolean[] = []; // true = concluído, false = futuro

  // Voos: concluído quando o último trecho (arrivalDate > departureDate) passou
  for (const f of booking.flights ?? []) {
    const arr = parseTravelDate(f.arrivalDate);
    const dep = parseTravelDate(f.departureDate);
    const ref = arr ?? dep;
    if (ref) itemStatuses.push(isDatePast(ref));
  }

  // Hotéis: concluído quando check-out passou
  for (const h of booking.hotels ?? []) {
    const co = parseTravelDate((h as any).checkOut ?? (h as any).check_out);
    const ci = parseTravelDate((h as any).checkIn ?? (h as any).check_in);
    const ref = co ?? ci;
    if (ref) itemStatuses.push(isDatePast(ref));
  }

  // Carros: concluído quando data de devolução passou
  for (const c of booking.car_rentals ?? []) {
    const ret = parseTravelDate(c.returnDate);
    const pick = parseTravelDate(c.pickupDate);
    const ref = ret ?? pick;
    if (ref) itemStatuses.push(isDatePast(ref));
  }

  if (itemStatuses.length === 0) return 'unknown';
  if (itemStatuses.every(Boolean)) return 'completed';
  if (itemStatuses.every(s => !s)) return 'upcoming';
  return 'partial';
}

// ─── Consolidação de passageiros ───────────────────────────────────────────────

export interface NormalizedPassenger {
  name: string;
  key: string; // cpf (digits-only) ou 'name:NOME'
}

/**
 * Retorna lista deduplicada de passageiros.
 * Prioridade: booking.passengers (JSON) > flights > hotels.
 * Deduplicação: CPF (somente dígitos) como chave primária; fallback nome normalizado.
 */
export function consolidatePassengers(booking: {
  passengers?: any[] | null;
  flights?: Array<{ passengerName?: string }> | null;
  hotels?: Array<{ guestName?: string; guest_name?: string }> | null;
}): NormalizedPassenger[] {
  const map = new Map<string, NormalizedPassenger>();

  const add = (name: string, cpf?: string) => {
    const n = String(name ?? '').trim();
    if (!n) return;
    const digits = (cpf ?? '').replace(/\D/g, '');
    const key = digits.length === 11 ? `cpf:${digits}` : `name:${n.toUpperCase()}`;
    if (!map.has(key)) map.set(key, { name: n, key });
  };

  // 1. booking.passengers (fonte mais completa)
  if (Array.isArray(booking.passengers) && booking.passengers.length > 0) {
    for (const p of booking.passengers) {
      const name = (p.name ?? p.fullName ?? '').toString().trim();
      const cpf = (p.cpf ?? '').toString();
      add(name, cpf);
    }
    // Se a fonte passengers está preenchida, não mistura com flights para evitar duplicatas
    return Array.from(map.values());
  }

  // 2. Fallback: voos (podem ter mesmo passageiro em ida+volta — deduplicar por nome)
  if (Array.isArray(booking.flights)) {
    for (const f of booking.flights) {
      if (f.passengerName) add(f.passengerName);
    }
  }

  // 3. Fallback: hotéis
  if (map.size === 0 && Array.isArray(booking.hotels)) {
    for (const h of booking.hotels as any[]) {
      const g = (h.guestName ?? h.guest_name ?? '').toString().trim();
      if (g) add(g);
    }
  }

  return Array.from(map.values());
}
