/**
 * statusUtils.ts
 * Funções utilitárias para determinar status temporal de voos, hospedagens e carros.
 * Usado em FlightsPage, HotelsPage, CarRentalsPage.
 */

export type ItemStatus = 'upcoming' | 'completed' | 'unknown';

/**
 * Parseia uma data no formato DD/MM/YYYY ou YYYY-MM-DD.
 * Retorna null se não conseguir parsear.
 */
export function parseDateBR(input?: string | null): Date | null {
  const s = (input || '').trim();
  if (!s) return null;

  // DD/MM/YYYY
  const mBR = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mBR) {
    return new Date(Number(mBR[3]), Number(mBR[2]) - 1, Number(mBR[1]));
  }

  // YYYY-MM-DD
  const mISO = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mISO) {
    return new Date(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]));
  }

  return null;
}

/**
 * Parseia data + hora (HH:MM ou HH:MM:SS) em um Date.
 */
export function parseDateTimeBR(date?: string | null, time?: string | null): Date | null {
  const d = parseDateBR(date);
  if (!d) return null;

  if (time) {
    const parts = time.trim().split(':');
    d.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, Number(parts[2]) || 0, 0);
  }
  return d;
}

/**
 * Status de um VOO:
 * - completed: data/hora de chegada já passou (ou fallback: data de partida)
 * - upcoming: data/hora de partida ainda não ocorreu
 * - unknown: não há datas suficientes
 */
export function getFlightStatus(flight: {
  departureDate?: string | null;
  departureTime?: string | null;
  arrivalDate?: string | null;
  arrivalTime?: string | null;
}): ItemStatus {
  const now = new Date();

  const arrival = parseDateTimeBR(flight.arrivalDate, flight.arrivalTime);
  if (arrival) {
    return arrival < now ? 'completed' : 'upcoming';
  }

  // Fallback: usa data de partida
  const departure = parseDateTimeBR(flight.departureDate, flight.departureTime);
  if (departure) {
    return departure < now ? 'completed' : 'upcoming';
  }

  return 'unknown';
}

/**
 * Status de uma HOSPEDAGEM:
 * - completed: check-out já passou
 * - upcoming: check-in no futuro OU ainda dentro da estadia
 * - unknown: sem datas
 */
export function getHotelStatus(hotel: {
  checkIn?: string | null;
  check_in?: string | null;
  checkOut?: string | null;
  check_out?: string | null;
}): ItemStatus {
  const now = new Date();
  now.setHours(0, 0, 0, 0); // compara só por dia

  const checkOutRaw = hotel.check_out || hotel.checkOut;
  const checkInRaw = hotel.check_in || hotel.checkIn;

  const checkOut = parseDateBR(checkOutRaw);
  if (checkOut) {
    checkOut.setHours(12, 0, 0, 0); // checkout padrão 12:00
    return checkOut < new Date() ? 'completed' : 'upcoming';
  }

  const checkIn = parseDateBR(checkInRaw);
  if (checkIn) {
    return checkIn < now ? 'completed' : 'upcoming';
  }

  return 'unknown';
}

/**
 * Status de um CARRO/TRANSFER:
 * - completed: devolução já passou
 * - upcoming: retirada no futuro OU ainda dentro do período
 * - unknown: sem datas
 */
export function getCarStatus(car: {
  pickupDate?: string | null;
  pickupTime?: string | null;
  returnDate?: string | null;
  returnTime?: string | null;
}): ItemStatus {
  const now = new Date();

  const returnDt = parseDateTimeBR(car.returnDate, car.returnTime);
  if (returnDt) {
    return returnDt < now ? 'completed' : 'upcoming';
  }

  const pickupDt = parseDateTimeBR(car.pickupDate, car.pickupTime);
  if (pickupDt) {
    return pickupDt < now ? 'completed' : 'upcoming';
  }

  return 'unknown';
}
