import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

/**
 * Shared utilities for the generic extractor (non-IDDAS).
 * Important: this file exists mainly to ensure function deploys do not fail.
 * The generic extraction is intentionally conservative.
 */

export function normalizeText(s: string): string {
  return (s || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchPageText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const headers = new Headers();
  headers.set(
    "user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
  );
  headers.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  headers.set("accept-language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7");

  const resp = await fetch(url, { method: "GET", headers, redirect: "follow" });
  const text = await resp.text().catch(() => "");
  return { ok: resp.ok, status: resp.status, text };
}

type Passenger = {
  fullName: string;
  birthDate: string; // YYYY-MM-DD
  cpf: string; // digits
  phone: string;
  email: string;
  passport: string;
  passportExpiry: string;
};

function toISODateFromBR(dmy: string): string {
  const m = (dmy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function cleanCpf(v: string): string {
  return (v || "").replace(/\D/g, "");
}

function safeName(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/**
 * Very conservative passenger extractor:
 * - looks for CPF on the page
 * - tries to capture a name close to the CPF
 */
export function extractPassengers(pageText: string): Passenger[] {
  const text = normalizeText(pageText);
  const out: Passenger[] = [];
  const seen = new Set<string>();

  // Capture CPF with optional nearby birth date
  const cpfRegex = /(CPF\s*[:\-]?\s*)?(\d{3}\.?\d{3}\.?\d{3}\-?\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = cpfRegex.exec(text)) !== null) {
    const cpfDigits = cleanCpf(m[2]);
    if (cpfDigits.length !== 11) continue;
    if (seen.has(cpfDigits)) continue;

    const sliceStart = Math.max(0, m.index - 120);
    const ctx = text.slice(sliceStart, m.index).replace(/\s+/g, " ");
    const nameMatch = ctx.match(/([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ'’\.\-]+(?:\s+[A-Za-zÀ-ÿ'’\.\-]{2,}){1,8})\s*$/);
    const fullName = safeName(nameMatch?.[1] || "");

    // Birth date: only if explicitly labeled
    const after = text.slice(m.index, Math.min(text.length, m.index + 200));
    const birthMatch = after.match(/\b(Nasc|Nascimento)\b[:\s]*([0-3]\d\/[0-1]\d\/\d{4})/i);
    const birthDate = birthMatch?.[2] ? toISODateFromBR(birthMatch[2]) : "";

    out.push({
      fullName,
      birthDate,
      cpf: cpfDigits,
      phone: "",
      email: "",
      passport: "",
      passportExpiry: "",
    });
    seen.add(cpfDigits);
  }

  return out;
}

export function extractMainPassengerName(pageText: string): string {
  const passengers = extractPassengers(pageText);
  if (passengers.length && passengers[0].fullName) return passengers[0].fullName;

  // Fallback: common label
  const m = normalizeText(pageText).match(/Reservado por\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{5,})/i);
  return (m?.[1] || "").trim();
}

type ExtractedFlight = {
  airline: string;
  flightNumber: string;
  origin: string;
  originCode: string;
  destination: string;
  destinationCode: string;
  departureDate: string;
  departureTime: string;
  arrivalDate: string;
  arrivalTime: string;
  locator: string;
  passengerName: string;
  type: "outbound" | "return" | "internal";
  stops: number;
  id: string;
};

function inferAirline(block: string): string {
  const b = (block || "").toUpperCase();
  if (b.includes("GOL")) return "GOL";
  if (b.includes("LATAM")) return "LATAM";
  if (b.includes("AZUL")) return "AZUL";
  return "";
}

export function matchAllFlights(pageText: string, mainPassengerName: string): ExtractedFlight[] {
  const text = normalizeText(pageText);
  const flights: ExtractedFlight[] = [];

  const headerRegex = /Voo de\s+(.+?)\s+\(([A-Z]{3})\)\s+para\s+(.+?)\s+\(([A-Z]{3})\)/g;
  const indices: { start: number; origin: string; originCode: string; destination: string; destinationCode: string }[] = [];
  let mh: RegExpExecArray | null;
  while ((mh = headerRegex.exec(text)) !== null) {
    indices.push({
      start: mh.index,
      origin: mh[1].trim(),
      originCode: mh[2].trim(),
      destination: mh[3].trim(),
      destinationCode: mh[4].trim(),
    });
  }

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].start;
    const end = i + 1 < indices.length ? indices[i + 1].start : text.length;
    const block = text.slice(start, end);

    const dep = block.match(/Partida\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}h\d{2})/i);
    const arr = block.match(/Chegada\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}h\d{2})/i);
    const voo = block.match(/Voo\s+(\d{3,4})/i);
    const loc = block.match(/Localizador\s+([A-Z0-9]{5,8})/i)?.[1] || "";
    const airline = inferAirline(block);
    const type: "outbound" | "return" = i === 0 ? "outbound" : "return";
    const id = `${loc || "NOLOC"}:${voo?.[1] || "NOVOO"}:${i}`;

    flights.push({
      airline,
      flightNumber: voo?.[1] || "",
      origin: indices[i].origin,
      originCode: indices[i].originCode,
      destination: indices[i].destination,
      destinationCode: indices[i].destinationCode,
      departureDate: dep?.[1] || "",
      departureTime: dep?.[2] || "",
      arrivalDate: arr?.[1] || "",
      arrivalTime: arr?.[2] || "",
      locator: loc,
      passengerName: mainPassengerName || "",
      type,
      stops: 0,
      id,
    });
  }

  return flights;
}

type ExtractedHotel = {
  hotelName: string;
  address: string;
  city: string;
  checkIn: string;
  checkOut: string;
  confirmationCode: string;
  guestName: string;
  diarias?: number;
};

function parseHotelDates(block: string): { checkIn: string; checkOut: string } {
  const ci = block.match(/Check-?in\s*[:\s]*([0-3]\d\/[0-1]\d\/\d{4})/i)?.[1] || "";
  const co = block.match(/Check-?out\s*[:\s]*([0-3]\d\/[0-1]\d\/\d{4})/i)?.[1] || "";
  return { checkIn: ci, checkOut: co };
}

export function extractHotels(pageText: string, mainPassengerName: string): ExtractedHotel[] {
  const text = normalizeText(pageText);
  const out: ExtractedHotel[] = [];

  // Try HTML parsing first to grab something usable.
  try {
    const doc = new DOMParser().parseFromString(text, "text/html");
    if (doc) {
      // no-op, keep fallback below
    }
  } catch {
    // ignore
  }

  // Fallback heuristics in plain text
  const hotelBlock = text.match(/Hospedagem[\s\S]{0,2000}/i)?.[0] || "";
  if (!hotelBlock) return out;

  const name = hotelBlock.match(/Hotel\s*[:\-]?\s*([^\n]{3,120})/i)?.[1] || "";
  const address = hotelBlock.match(/Endere[cç]o\s*[:\-]?\s*([^\n]{3,200})/i)?.[1] || "";
  const city = hotelBlock.match(/Cidade\s*[:\-]?\s*([^\n]{2,120})/i)?.[1] || "";
  const conf = hotelBlock.match(/(Confirma[cç][aã]o|Reserva|Localizador)\s*[:\-]?\s*([A-Z0-9\-]{4,20})/i)?.[2] || "";
  const { checkIn, checkOut } = parseHotelDates(hotelBlock);

  const hotelName = safeName(name);
  if (!hotelName && !checkIn && !checkOut && !conf) return out;

  out.push({
    hotelName,
    address: safeName(address),
    city: safeName(city),
    checkIn,
    checkOut,
    confirmationCode: safeName(conf),
    guestName: mainPassengerName || "",
  });

  return out;
}
