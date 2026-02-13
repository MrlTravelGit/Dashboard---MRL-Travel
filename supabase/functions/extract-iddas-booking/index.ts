import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeText(s: string) {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMoneyBRL(text: string): number | null {
  const m = text.match(/R\$\s*([\d.]+,\d{2})/i);
  if (!m) return null;
  const v = m[1].replace(/\./g, "").replace(",", ".");
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function inferAirline(block: string): "GOL" | "LATAM" | "AZUL" | "" {
  const b = block.toUpperCase();
  if (b.includes("GOL")) return "GOL";
  if (b.includes("LATAM")) return "LATAM";
  if (b.includes("AZUL")) return "AZUL";
  return "";
}

// Extract "Reservado por" separately; should NOT be used as a passenger
function extractReservedBy(pageText: string): string | null {
  const m = pageText.match(/Reservado por\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{5,})/i);
  return m?.[1]?.trim() || null;
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

function matchAllFlights(pageText: string, mainPassengerName: string): ExtractedFlight[] {
  const flights: ExtractedFlight[] = [];

  const headerRegex =
    /Voo de\s+(.+?)\s+\(([A-Z]{3})\)\s+para\s+(.+?)\s+\(([A-Z]{3})\)/g;

  const indices: {
    start: number;
    origin: string;
    originCode: string;
    destination: string;
    destinationCode: string;
  }[] = [];

  let mh: RegExpExecArray | null;
  while ((mh = headerRegex.exec(pageText)) !== null) {
    indices.push({
      start: mh.index,
      origin: mh[1].trim(),
      originCode: mh[2].trim(),
      destination: mh[3].trim(),
      destinationCode: mh[4].trim(),
    });
  }

  let lastAirline: string = "";

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].start;
    const end = i + 1 < indices.length ? indices[i + 1].start : pageText.length;
    const block = pageText.slice(start, end);

    const dep = block.match(/Partida\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}h\d{2})/i);
    const arr = block.match(/Chegada\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}h\d{2})/i);
    const voo = block.match(/Voo\s+(\d{3,4})/i);

    const loc =
      block.match(/Localizador\s+([A-Z0-9]{5,8})/i)?.[1] ||
      block.match(/\b[A-Z0-9]{5,8}\b/)?.[0] ||
      "";

    let airline = inferAirline(block) as any;
    if (!airline && lastAirline) airline = lastAirline;
    if (airline) lastAirline = airline;

    const passengerName = mainPassengerName || "";

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
      passengerName,
      type,
      stops: block.match(/Voo direto/i) ? 0 : 0,
      id,
    });
  }

  return flights;
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
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function cleanCpf(v: string): string {
  return (v || "").replace(/\D/g, "");
}

// Utility: normalize CPF to digits-only string
function normalizeCPF(cpf: string): string {
  if (!cpf) return '';
  return cpf.replace(/\D/g, '');
}

// Utility: quick heuristics to detect company-like names
function looksLikeCompanyName(name: string): boolean {
  if (!name) return false;
  const clean = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
  const terms = ['LTDA', 'S/A', 'SA', 'ME', 'EPP', 'EIRELI', 'ADMINISTRACAO', 'ADMINISTRACAO', 'ADMINISTRACAO', 'HOLDING'];
  for (const t of terms) {
    if (clean.includes(t)) return true;
  }
  return false;
}

function extractPassengers(pageText: string): Passenger[] {
  // Suporta 2 formatos:
  // 1) "NOME, dd/mm/aaaa, CPF xxx..."
  // 2) linha do NOME e abaixo linha "CPF: ... Nasc: ..."

  const text = pageText
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .trim();

  // tenta achar o começo do bloco de passageiros
  const secMatch =
    text.match(/Passageiros[\s:]*\d+\s*Adultos?/i) ||
    text.match(/\bPassageiros\b/i);

  if (!secMatch) return [];

  const startIdx = secMatch.index ?? 0;
  const tail = text.slice(startIdx);

  const lines = tail.split("\n").map((l) => l.trim()).filter(Boolean);

  // coletar linhas até começar outro bloco
  const passengerLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) break;

    if (
      /^(Hotel|Hospedagem|Voo|Voos|Pagamento|Total|Forma de pagamento|Localizador|Código:)/i.test(
        line
      )
    ) {
      break;
    }

    passengerLines.push(line);
  }

  // fallback: se não coletou nada, tenta pegar as primeiras linhas que tenham CPF
  if (passengerLines.length === 0) {
    const cpfLineRegex = /\bCPF\b|(\d{3}\.?\d{3}\.?\d{3}[-\s]?\d{2})/;
    for (const l of tail.split("\n").slice(0, 40)) {
      const line = l.trim();
      if (cpfLineRegex.test(line)) passengerLines.push(line);
    }
  }

  const map = new Map<string, Passenger>();

  let pendingName = ""; // guarda nome quando vem em linha separada

  for (let i = 0; i < passengerLines.length; i++) {
    const raw = passengerLines[i];
    const line = raw.replace(/\s+/g, " ").trim();

    if (!line) continue;

    // ignora “Reservado por” e variações
    if (/^Reservado por\b/i.test(line)) {
      pendingName = "";
      continue;
    }

    // se a linha parece só o nome (sem CPF), guarda e segue
    const hasCPF =
      /\bCPF\b/i.test(line) ||
      /(\d{3}\.?\d{3}\.?\d{3}[-\s]?\d{2})/.test(line);

    if (!hasCPF) {
      // pega nome antes de qualquer vírgula
      const nameOnly = line.split(",")[0]?.trim() ?? "";
      if (nameOnly && !looksLikeCompanyName(nameOnly)) {
        pendingName = nameOnly;
      }
      continue;
    }

    // extrai CPF
    const cpfMatch =
      line.match(/CPF[:\s]*([0-9.\- ]{11,14})/i) ||
      line.match(/(\d{3}\.?\d{3}\.?\d{3}[-\s]?\d{2})/);

    if (!cpfMatch) continue;

    const cpfDigits = normalizeCPF(cpfMatch[1] ?? cpfMatch[0]);
    if (cpfDigits.length !== 11) continue;
    if (map.has(cpfDigits)) continue; // dedupe por CPF

    // extrai nome: pode estar na própria linha antes da vírgula, ou na linha anterior (pendingName)
    let nameCandidate = "";
    const beforeCPF = line.split(/\bCPF\b/i)[0]?.trim() ?? "";
    const maybeInlineName = beforeCPF.split(",")[0]?.trim() ?? "";

    if (maybeInlineName && !/^CPF[:\s]*/i.test(maybeInlineName)) {
      nameCandidate = maybeInlineName;
    } else if (pendingName) {
      nameCandidate = pendingName;
    }

    pendingName = ""; // consumiu

    // ignora empresa e “reservador”
    if (!nameCandidate) continue;
    if (looksLikeCompanyName(nameCandidate)) continue;

    // data nascimento
    const birthMatch = line.match(/Nasc[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i) || line.match(/(\d{2}\/\d{2}\/\d{4})/);
    const birthDate = birthMatch ? toISODateFromBR(birthMatch[1]) : "";

    // telefone
    const phoneMatch = line.match(/\(\d{2}\)\s*\d{4,5}-\d{4}|\b\d{10,11}\b/);
    const phone = phoneMatch ? phoneMatch[0].trim() : "";

    // email
    const emailMatch = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const email = emailMatch ? emailMatch[0].trim() : "";

    // passaporte
    const passportMatch = line.match(/Passaporte[:\s]*([A-Z0-9-]+)/i);
    const passport = passportMatch ? passportMatch[1].trim() : "";

    map.set(cpfDigits, {
      fullName: nameCandidate,
      birthDate: birthDate || "",
      cpf: cpfDigits,
      phone: phone || "",
      email: email || "",
      passport: passport || "",
      passportExpiry: "",
    });
  }

  return Array.from(map.values());
}


function matchAllHotels(pageText: string): ExtractedHotel[] {
  const hotels: ExtractedHotel[] = [];
  // Tenta encontrar blocos que contenham hotel/hospedagem
  const hotelRegex = /(Hotel|Hospedagem)[:\s-]*([^\n\r]+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = hotelRegex.exec(pageText)) !== null) {
    const blockStart = m.index;
    const start = Math.max(0, blockStart - 200);
    const end = Math.min(pageText.length, blockStart + 600);
    const chunk = pageText.slice(start, end);

    const name = (m[2] || '').trim();
    const cityMatch = chunk.match(/Cidade[:\s]*([A-ZÀ-Ÿa-zà-ÿ\- ]{2,80})/i);
    const checkIn = chunk.match(/Check[- ]?in[:\s]*([0-3]?\d\/[01]?\d\/[0-9]{4})/i)?.[1] || '';
    const checkOut = chunk.match(/Check[- ]?out[:\s]*([0-3]?\d\/[01]?\d\/[0-9]{4})/i)?.[1] || '';
    const confirm = chunk.match(/(Confirmação|Código|Reserva)[:\s]*([A-Z0-9\-]{4,20})/i)?.[2] || '';
    const total = parseMoneyBRL(chunk) ?? null;

    hotels.push({
      hotelName: name || '',
      city: cityMatch ? cityMatch[1].trim() : undefined,
      checkIn: checkIn || undefined,
      checkOut: checkOut || undefined,
      confirmationCode: confirm || undefined,
      total,
      passengers: [],
    });
  }

  return hotels;
}

type ExtractedCar = {
  company?: string;
  pickupLocation?: string;
  pickupDateTime?: string;
  dropoffLocation?: string;
  dropoffDateTime?: string;
  confirmationCode?: string;
  category?: string;
  driverName?: string;
};

function matchAllCars(pageText: string): ExtractedCar[] {
  const cars: ExtractedCar[] = [];
  // Procura por blocos que mencionem locadora/retirada/devolução
  const carRegex = /(Locadora|Aluguel|Retirada|Devolu[cç][aã]o)[:\s-]*([^\n\r]+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = carRegex.exec(pageText)) !== null) {
    const blockStart = m.index;
    const start = Math.max(0, blockStart - 200);
    const end = Math.min(pageText.length, blockStart + 600);
    const chunk = pageText.slice(start, end);

    const companyMatch = chunk.match(/Locadora[:\s]*([A-ZÀ-Ÿa-zà-ÿ0-9\- ]{2,80})/i);
    const pickupMatch = chunk.match(/Retirada[:\s]*([0-3]?\d\/[01]?\d\/[0-9]{4}(?:\s+\d{2}:?\d{2})?)/i);
    const dropoffMatch = chunk.match(/Devolu[cç][aã]o[:\s]*([0-3]?\d\/[01]?\d\/[0-9]{4}(?:\s+\d{2}:?\d{2})?)/i);
    const confirm = chunk.match(/(Confirmação|Código)[:\s]*([A-Z0-9\-]{4,20})/i)?.[2] || '';
    const category = chunk.match(/Categoria[:\s]*([A-Z0-9\- ]{2,40})/i)?.[1] || '';
    const driver = chunk.match(/Motorista[:\s]*([A-ZÀ-Ÿa-zà-ÿ ]{2,80})/i)?.[1] || '';

    cars.push({
      company: companyMatch ? companyMatch[1].trim() : undefined,
      pickupDateTime: pickupMatch ? pickupMatch[1].trim() : undefined,
      dropoffDateTime: dropoffMatch ? dropoffMatch[1].trim() : undefined,
      confirmationCode: confirm || undefined,
      category: category || undefined,
      driverName: driver || undefined,
    });
  }

  return cars;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const bodyText = await req.text();
    const body = bodyText ? JSON.parse(bodyText) : null;
    const url = body?.url;

    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ success: false, error: "Envie { url: string }" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      },
    });

    if (!r.ok) {
      return new Response(JSON.stringify({ success: false, error: `Falha ao buscar URL (${r.status})` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rawText = doc?.body?.textContent || "";
    const pageText = normalizeText(rawText);

    const total = parseMoneyBRL(pageText);
    const reservedBy = extractReservedBy(pageText);
    const passengers = extractPassengers(pageText);
    
    // mainPassengerName is ALWAYS the first passenger real, otherwise empty
    const mainPassengerName = passengers.length > 0 ? passengers[0].fullName : "";
    
    const flights = matchAllFlights(pageText, mainPassengerName);
    const hotels = matchAllHotels(pageText) || [];
    const cars = matchAllCars(pageText) || [];

    const suggestedTitle =
      flights.length > 0
        ? `${flights[0].originCode} à ${flights[0].destinationCode} (${flights[0].departureDate || "sem data"})`
        : "Reserva (link)";

    // Helper: parse dd/MM/yyyy -> Date
    function parseBRDate(dmy?: string | null | undefined): Date | null {
      if (!dmy) return null;
      const s = dmy.trim();
      if (!s || s === '-') return null;
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return null;
      const day = Number(m[1]);
      const month = Number(m[2]) - 1;
      const year = Number(m[3]);
      const dt = new Date(year, month, day);
      if (Number.isNaN(dt.getTime())) return null;
      return dt;
    }

    function formatBRDate(d: Date | null): string | null {
      if (!d) return null;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }

    // derive min/max flight departure dates
    const flightDates: Date[] = [];
    for (const f of flights) {
      const d = parseBRDate(f.departureDate);
      if (d) flightDates.push(d);
    }
    let flightMin: Date | null = null;
    let flightMax: Date | null = null;
    if (flightDates.length > 0) {
      flightDates.sort((a, b) => a.getTime() - b.getTime());
      flightMin = flightDates[0];
      flightMax = flightDates[flightDates.length - 1];
    }

    // Normalize hotels to include name and computed checkIn/checkOut as dd/MM/yyyy or null
    const hotelsOut = hotels.map((h) => {
      const rawCheckIn = (h.checkIn || (h as any).check_in || '') as string;
      const rawCheckOut = (h.checkOut || (h as any).check_out || '') as string;
      let ci = parseBRDate(rawCheckIn);
      let co = parseBRDate(rawCheckOut);

      // If neither present, derive from flights
      if ((!ci || !co) && flightMin && flightMax) {
        if (!ci) ci = flightMin;
        if (!co) co = flightMax;
        // if equal, add 1 day to checkOut
        if (ci && co && ci.getTime() === co.getTime()) {
          const next = new Date(co.getTime());
          next.setDate(next.getDate() + 1);
          co = next;
        }
      }

      // If only one side exists and flights provide a complement, try to complement
      if (ci && !co && flightMax) {
        co = flightMax;
        if (ci.getTime() === co.getTime()) {
          const next = new Date(co.getTime());
          next.setDate(next.getDate() + 1);
          co = next;
        }
      }
      if (co && !ci && flightMin) {
        ci = flightMin;
        if (ci.getTime() === co.getTime()) {
          const next = new Date(co.getTime());
          next.setDate(next.getDate() + 1);
          co = next;
        }
      }

      return {
        name: h.hotelName || (h as any).name || null,
        confirmationCode: h.confirmationCode || (h as any).confirm || undefined,
        checkIn: formatBRDate(ci),
        checkOut: formatBRDate(co),
        city: h.city,
        address: h.address,
        total: h.total ?? null,
        passengers: h.passengers || [],
      };
    });

    // Normalize response to always include hotels and cars arrays (never null)
    // Convert passengers to frontend-friendly format: { name, cpf?, birthDate?, phone?, email?, passport? }
    const passengersOut = passengers.map(p => ({
      name: p.fullName,
      cpf: p.cpf || undefined,
      birthDate: p.birthDate || undefined,
      phone: p.phone || undefined,
      email: p.email || undefined,
      passport: p.passport || undefined,
    }));

    const dataOut = {
      total: total ?? null,
      suggestedTitle,
      mainPassengerName,
      passengers: passengersOut,
      reservedBy,
      flights,
      hotels: hotelsOut,
      cars,
    };

    return new Response(
      JSON.stringify({
        success: true,
        data: dataOut,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || "Erro" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
