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
