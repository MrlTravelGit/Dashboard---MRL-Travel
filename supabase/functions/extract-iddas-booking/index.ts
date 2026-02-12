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


type ExtractedHotel = {
  locator: string;
  hotelName: string;
  checkIn: string;  // DD/MM/YYYY
  checkOut: string; // DD/MM/YYYY
  nights: number;
  rooms: number;
  breakfast: boolean;
  guestName: string;
  pricePaid: number;
  priceOriginal: number;
  id: string;
};

function parseIntSafe(v: string | undefined | null, fallback = 0) {
  const n = Number(String(v ?? "").replace(/[^0-9]/g, ""));
  return Number.isNaN(n) ? fallback : n;
}

function extractHotels(pageText: string, mainPassengerName: string): ExtractedHotel[] {
  const hotels: ExtractedHotel[] = [];

  // Tentamos encontrar blocos com indicação de hotel/hospedagem.
  // O IDDAS costuma renderizar textos como "Hotel", "Hospedagem", "Check-in", "Check-out", "Entrada", "Saída".
  const markers = ["HOTEL", "HOSPEDAGEM", "CHECK-IN", "CHECK OUT", "CHECKOUT", "ENTRADA", "SAÍDA", "SAIDA"];

  const upper = pageText.toUpperCase();

  // Se não houver nenhum marcador relevante, não tenta.
  if (!markers.some((m) => upper.includes(m))) return hotels;

  // Estratégia:
  // 1) Quebra o texto em blocos por ocorrência de "Hotel" ou "Hospedagem".
  // 2) Para cada bloco, tenta capturar nome, datas, localizador e hóspede.
  const splitRegex = /\b(?:Hotel|Hospedagem)\b/gi;
  const parts: { start: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = splitRegex.exec(pageText)) !== null) {
    const start = m.index;
    const end = (() => {
      const next = splitRegex.exec(pageText);
      if (next) {
        // volta o cursor  para não pular uma ocorrência
        splitRegex.lastIndex = next.index;
        return next.index;
      }
      return pageText.length;
    })();
    parts.push({ start, text: pageText.slice(start, end) });
  }

  // Se não conseguiu quebrar, tenta um bloco único com a página inteira
  if (parts.length === 0) parts.push({ start: 0, text: pageText });

  for (let i = 0; i < parts.length; i++) {
    const block = parts[i].text;

    // Datas
    const checkIn =
      block.match(/Check-?in\s*[:\s]*([0-3]\d\/[01]\d\/\d{4})/i)?.[1] ||
      block.match(/Entrada\s*[:\s]*([0-3]\d\/[01]\d\/\d{4})/i)?.[1] ||
      "";

    const checkOut =
      block.match(/Check-?out\s*[:\s]*([0-3]\d\/[01]\d\/\d{4})/i)?.[1] ||
      block.match(/Sa[ií]da\s*[:\s]*([0-3]\d\/[01]\d\/\d{4})/i)?.[1] ||
      "";

    // Localizador
    const locator =
      block.match(/Localizador\s*[:\s]*([A-Z0-9]{5,10})/i)?.[1] ||
      block.match(/Reserva\s*[:\s]*([A-Z0-9]{5,10})/i)?.[1] ||
      "";

    // Nome do hotel
    // Tenta alguns padrões comuns: "Hotel: X", "Nome do hotel: X", ou uma linha em caixa alta depois do marcador.
    let hotelName =
      block.match(/Hotel\s*[:\s]+([^\n]{3,80})/i)?.[1]?.trim() ||
      block.match(/Nome do hotel\s*[:\s]+([^\n]{3,80})/i)?.[1]?.trim() ||
      "";

    if (!hotelName) {
      const candidates = block
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 12);

      // pega a maior linha que não seja só rótulo e não contenha datas
      const best = candidates
        .filter((l) => !/check-?in|check-?out|entrada|sa[ií]da|localizador|reserva|noites|quartos/i.test(l))
        .filter((l) => !/\b\d{2}\/\d{2}\/\d{4}\b/.test(l))
        .sort((a, b) => b.length - a.length)[0];

      hotelName = (best || "").replace(/\s{2,}/g, " ").trim();
    }

    // Hóspede
    const guestName =
      block.match(/H[oó]spede\s*[:\s]+([^\n]{3,80})/i)?.[1]?.trim() ||
      block.match(/Titular\s*[:\s]+([^\n]{3,80})/i)?.[1]?.trim() ||
      mainPassengerName ||
      "";

    // Noites e quartos
    const nights = parseIntSafe(block.match(/Noites?\s*[:\s]*(\d{1,2})/i)?.[1], 0);
    const rooms = parseIntSafe(block.match(/Quartos?\s*[:\s]*(\d{1,2})/i)?.[1], 1);

    // Café da manhã
    const breakfast =
      /cafe\s*da\s*manha|caf[eé]\s*da\s*manh[aã]|breakfast/i.test(block) &&
      !/sem\s+cafe\s*da\s*manha|n[aã]o\s+inclui\s+cafe\s*da\s*manha/i.test(block);

    // Preços (se houver)
    const pricePaid = parseMoneyBRL(block) ?? 0;
    const priceOriginal = 0;

    // Só considera hotel se tiver pelo menos nome ou datas
    if (!hotelName && !checkIn && !checkOut) continue;

    const id = `${locator || "NOLOC"}:${hotelName || "NOHOTEL"}:${checkIn || "NODATE"}:${i}`;

    hotels.push({
      locator,
      hotelName,
      checkIn,
      checkOut,
      nights,
      rooms,
      breakfast,
      guestName,
      pricePaid,
      priceOriginal,
      id,
    });
  }

  // Remover duplicados pelo id
  const seen = new Set<string>();
  return hotels.filter((h) => {
    if (seen.has(h.id)) return false;
    seen.add(h.id);
    return true;
  });
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
  const lines = pageText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Heurística: linhas que têm CPF e data no formato dd/mm/aaaa
  for (const line of lines) {
    if (!/\bCPF\b/i.test(line)) continue;
    const m = line.match(/^([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{5,}),\s*(\d{2}\/\d{2}\/\d{4}).*?\bCPF\b[:\s]*([\d.\-]{11,14})/i);
    if (!m) continue;

    const fullName = m[1].trim();
    const birthDate = toISODateFromBR(m[2]);
    const cpf = cleanCpf(m[3]);

    if (!fullName || !birthDate || cpf.length !== 11) continue;

    const email = (line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "").trim();

    // Telefone: tenta formatos comuns, senão deixa vazio
    const phoneMatch =
      line.match(/\(\d{2}\)\s*\d{4,5}-\d{4}/) ||
      line.match(/\b\d{2}\s*\d{4,5}-\d{4}\b/) ||
      null;
    const phone = (phoneMatch?.[0] || "").trim();

    const passport = (line.match(/Passaporte[:\s]*([A-Z0-9]{5,})/i)?.[1] || "").trim();

    passengers.push({
      fullName,
      birthDate,
      cpf,
      phone,
      email,
      passport,
      passportExpiry: "",
    });
  }

  // Remove duplicados por CPF
  const seen = new Set<string>();
  return passengers.filter((p) => {
    if (seen.has(p.cpf)) return false;
    seen.add(p.cpf);
    return true;
  });
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
    let mainPassengerName = extractMainPassengerName(pageText);
    const flights = matchAllFlights(pageText, mainPassengerName);
    const hotels = extractHotels(pageText, mainPassengerName);
    const passengers = extractPassengers(pageText);

    if (passengers.length > 0) {
      // Regra: o passageiro principal deve ser o primeiro passageiro extraído
      mainPassengerName = passengers[0].fullName || mainPassengerName;
    }

    const suggestedTitle =
      flights.length > 0
        ? `${flights[0].originCode} à ${flights[0].destinationCode} (${flights[0].departureDate || "sem data"})`
        : "Reserva (link)";

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          total,
          suggestedTitle,
          mainPassengerName,
          flights,
          hotels,
          passengers,
        },
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
