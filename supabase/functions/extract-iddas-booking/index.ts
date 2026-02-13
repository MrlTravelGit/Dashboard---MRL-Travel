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

function extractMainPassengerName(pageText: string): string {
  const m1 = pageText.match(/Reservado por\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{5,})/i);
  if (m1?.[1]) return m1[1].trim();

  const m2 = pageText.match(/([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{5,}),\s*\d{2}\/\d{2}\/\d{4},\s*CPF/i);
  if (m2?.[1]) return m2[1].trim();

  return "";
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

    let airline = inferAirline(block);
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

function extractPassengers(pageText: string): Passenger[] {
  const passengers: Passenger[] = [];

  // Normaliza para facilitar regex em blocos
  const text = pageText
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .trim();

  const cpfRegex = /\bCPF\b[:\s]*([\d.\-]{11,14})/gi;

  const seen = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = cpfRegex.exec(text)) !== null) {
    const cpf = cleanCpf(m[1] || "");
    if (cpf.length !== 11) continue;
    if (seen.has(cpf)) continue;

    const idx = m.index;

    // Janela ao redor do CPF para capturar nome e nascimento mesmo se estiverem em linhas separadas
    const start = Math.max(0, idx - 300);
    const end = Math.min(text.length, idx + 400);
    const chunk = text.slice(start, end);

    // Nome: pega a última sequência grande de letras antes do CPF
    // (funciona bem quando o IDDAS imprime "NOME SOBRENOME ..." antes dos dados)
    const nameCandidates = chunk
      .slice(0, Math.min(chunk.length, idx - start))
      .match(/[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{8,}/g);

    const fullName = (nameCandidates?.[nameCandidates.length - 1] || "")
      .replace(/\s{2,}/g, " ")
      .trim();

    // Nascimento: aceita "Nasc", "Nascimento" ou data solta perto do CPF
    const birthMatch =
      chunk.match(/\bNasc(?:imento)?\b[:\s]*([0-3]\d\/[01]\d\/\d{4})/i) ||
      chunk.match(/\b([0-3]\d\/[01]\d\/\d{4})\b/);

    const birthDate = birthMatch?.[1] ? toISODateFromBR(birthMatch[1]) : "";

    // Email
    const email =
      (chunk.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "").trim();

    // Telefone
    const phoneMatch =
      chunk.match(/\(\d{2}\)\s*\d{4,5}-\d{4}/) ||
      chunk.match(/\b\d{2}\s*\d{4,5}-\d{4}\b/) ||
      chunk.match(/\b\d{10,11}\b/);

    const phone = (phoneMatch?.[0] || "").trim();

    // Passaporte
    const passport =
      (chunk.match(/Passaporte[:\s]*([A-Z0-9]{5,})/i)?.[1] || "").trim();

    if (!fullName || !birthDate) {
      // Se faltar nome ou nascimento, não cadastra, mas já marca o CPF como visto para evitar loops
      seen.add(cpf);
      continue;
    }

    passengers.push({
      fullName,
      birthDate,
      cpf,
      phone,
      email,
      passport,
      passportExpiry: "",
    });

    seen.add(cpf);
  }

  return passengers;
}

type ExtractedHotel = {
  hotelName: string;
  city?: string;
  checkIn?: string;
  checkOut?: string;
  address?: string;
  confirmationCode?: string;
  total?: number | null;
  passengers?: any[];
};

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

serve(async (req) => {
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
    const mainPassengerName = extractMainPassengerName(pageText);
    const flights = matchAllFlights(pageText, mainPassengerName);
    const passengers = extractPassengers(pageText);
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
    const dataOut = {
      total: total ?? null,
      suggestedTitle,
      mainPassengerName,
      passengers,
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
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e?.message || "Erro" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
