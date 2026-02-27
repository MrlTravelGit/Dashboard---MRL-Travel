// Filtro de nomes rótulo e heurística de nome válido
function isLabelName(raw: string) {
  const s = (raw || "").trim().toLowerCase();

  const blocked = new Set([
    "adultos", "adulto",
    "crianças", "criancas",
    "criança", "crianca",
    "bebês", "bebes",
    "bebê", "bebe",
    "passageiros", "passageiro",
    "passageiros identificados", "passageiros identificadas",
    "identificados", "identificadas",
    "titular",
    "reservado por",
    "voo", "voos",
    "hospedagem", "hotel",
  ]);

  if (blocked.has(s)) return true;

  // também bloqueia casos tipo "Adultos (2)" ou "Passageiros: 2 Adultos"
  if (/^(adultos?|passageiros?)\b/.test(s)) return true;

  return false;
}

function isProbablyPersonName(name: string) {
  const n = (name || "").trim();
  if (!n) return false;
  if (isLabelName(n)) return false;

  // precisa ter letras
  if (!/[A-Za-zÀ-ÿ]/.test(n)) return false;

  // regra principal: 2+ palavras
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return true;

  // fallback: 1 palavra só aceita se for "forte" e não genérica
  if (parts.length === 1) {
    const w = parts[0];
    if (w.length < 6) return false;
    if (["adultos", "adulto", "passageiro", "passageiros"].includes(w.toLowerCase())) return false;
    return true;
  }

  return false;
}
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

function normalizeText(s: string) {
  return s
    .replace(/\u00a0/g, " ")
    // Normalize zero-width and other invisible separators that can break regexes
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Build a text representation that preserves block boundaries.
// doc.body.textContent often collapses everything into a single line, making
// passenger extraction unreliable.
function extractTextWithNewlines(doc: any): string {
  try {
    const body = doc?.body;
    if (!body) return "";

    const isBlockTag = (tag: string) => {
      const t = (tag || "").toLowerCase();
      return [
        "p",
        "div",
        "section",
        "article",
        "header",
        "footer",
        "main",
        "br",
        "li",
        "ul",
        "ol",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
      ].includes(t);
    };

    let out = "";

    const walk = (node: any) => {
      if (!node) return;
      const nodeType = node.nodeType;

      // 3 = TEXT_NODE
      if (nodeType === 3) {
        out += String(node.nodeValue || "");
        return;
      }

      // 1 = ELEMENT_NODE
      if (nodeType === 1) {
        const tag = (node.tagName || "").toString();
        if (isBlockTag(tag)) out += "\n";
        const children = node.childNodes || [];
        for (let i = 0; i < children.length; i++) walk(children[i]);
        if (isBlockTag(tag)) out += "\n";
      }
    };

    walk(body);
    return out;
  } catch {
    return "";
  }
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

function cleanSpacesLoose(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Remove tags like "(BR4BET)" at the end of a passenger name
function sanitizePassengerName(name: string) {
  let n = cleanSpacesLoose(name);
  n = n.replace(/\s*\(([A-Z0-9]{2,12})\)\s*$/i, "").trim();
  return n;
}

function getExpectedPassengerCount(text: string): number | null {
  const m =
    text.match(/Passageiros\s*:\s*(\d+)/i) ||
    text.match(/Passageiros[\s:]*\s*(\d+)\s*Adultos?/i) ||
    text.match(/Passageiros\s*:\s*(\d+)\s*Adultos?/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

// Name pattern that accepts connectors like "de", "da", "dos"
const NAME_CONNECTORS = "(?:de|da|do|dos|das|e|d'|del|della|van|von|la|le)";
const NAME_WORD = "\\p{Lu}[\\p{L}'’\\.\\-]{1,}";
const NAME_PART = `(?:${NAME_WORD}|${NAME_CONNECTORS})`;
const NAME_CAPTURE = `(${NAME_WORD}(?:\\s+${NAME_PART}){1,10})`;

function bestNameFromContext(before: string) {
  const s = cleanSpacesLoose(before)
    .replace(/\bCPF\b[:\s]*/gi, " ")
    .replace(/\bRG\b[:\s]*/gi, " ")
    .replace(/\bNasc\b[:\s]*/gi, " ")
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, " ")
    .replace(/[\s,;:]+/g, " ")
    .trim();

  const parts = s.split(" ").filter(Boolean);

  // Try long candidates first
  for (let take = 10; take >= 2; take--) {
    const cand = parts.slice(-take).join(" ");
    const c = sanitizePassengerName(cand);
    if (c && !looksLikeCompanyName(c) && isProbablyPersonName(c)) return c;
  }

  return "";
}

function birthNear(text: string) {
  // Only trust labeled birth dates here. Unlabeled dates near CPF often pick
  // travel/check-in dates and cause wrong outputs.
  const m1 = text.match(/\b(Nasc|Nascimento)\b[:\s]*([0-3]\d\/[0-1]\d\/\d{4})/i);
  if (m1) return m1[2];
  return "";
}

function extractBirthFromPassengerLine(line: string): string {
  const labeled = line.match(/\b(Nasc|Nascimento)\b[:\s]*([0-3]\d\/[0-1]\d\/\d{4})/i);
  if (labeled) return labeled[2];
  const inline = line.match(/,\s*([0-3]\d\/[0-1]\d\/\d{4})\s*,\s*CPF\b/i);
  if (inline) return inline[1];
  return "";
}

function getLineAroundIndex(text: string, idx: number): string {
  const start = Math.max(0, text.lastIndexOf("\n", idx) + 1);
  let end = text.indexOf("\n", idx);
  if (end < 0) end = text.length;
  return text.slice(start, end).trim();
}

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const withNewlines = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|table|section|article|header|footer|main|h\d)\s*>/gi, "\n")
    .replace(/<(div|p|li|tr|table|section|article|header|footer|main|h\d)\b[^>]*>/gi, "\n");

  const stripped = withNewlines.replace(/<[^>]+>/g, " ");
  return normalizeText(stripped);
}

function extractPassengers(pageText: string): Passenger[] {
  // Suporta 2 formatos:
  // 1) "NOME, dd/mm/aaaa, CPF xxx..."
  // 2) linha do NOME e abaixo linha "CPF: ... Nasc: ..."

  const text = pageText
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .trim();

  // tenta achar o começo do bloco de passageiros
  // Try to find a passenger section first. If not found, we still proceed with
  // a global CPF-based fallback (some layouts don't include the heading in textContent).
  const secMatch =
    text.match(/Passageiros\s+Identificados/i) ||
    text.match(/Passageiros[\s:]*\d+\s*Adultos?/i) ||
    text.match(/\bPassageiros\b/i) ||
    text.match(/\bViajantes\b/i) ||
    text.match(/\bPassageiro\(s\)\b/i);

  const startIdx = secMatch?.index ?? 0;
  const tailFull = text.slice(startIdx);

  // Restrict to the passenger block to avoid unrelated CPFs later in the page.
  // This also increases accuracy for pages where passengers appear before flights/hotel.
  const lower = tailFull.toLowerCase();
  // Atenção: evite marcadores genéricos como "total" ou "pagamento".
  // Em alguns layouts do IDDAS (principalmente Azul), "Valor Total" aparece
  // dentro do mesmo bloco visual de passageiros e cortava o trecho cedo demais.
  const endMarkers = [
    "voo de ida",
    "voo de volta",
    "hospedagem",
    "hotel",
    "itinerário",
    "itinerario",
  ];
  let endIdx = tailFull.length;
  for (const m of endMarkers) {
    const i = lower.indexOf(m, 10);
    if (i > -1 && i < endIdx) endIdx = i;
  }
  const tail = tailFull.slice(0, endIdx);

  const map = new Map<string, Passenger>();

  // Expected count (when present) helps decide when to run a stronger fallback.
  const expectedMatch =
    tailFull.match(/Passageiros\s*:\s*(\d+)/i) ||
    tailFull.match(/Passageiros[\s:]*\s*(\d+)\s*Adultos?/i) ||
    tail.match(/Passageiros\s*:\s*(\d+)/i) ||
    tail.match(/Passageiros[\s:]*\s*(\d+)\s*Adultos?/i);
  const expectedCount = expectedMatch ? Number(expectedMatch[1]) : null;

  // 0) High-recall pass: some IDDAS layouts collapse the whole reservation into
// a single visual line. In those cases, relying on "\n" boundaries fails.
// We first attempt global patterns over the passenger section.
{
  const upsert = (p: Passenger) => {
    const cpfDigits = normalizeCPF(p.cpf);
    if (cpfDigits.length !== 11) return;

    const incomingName = sanitizePassengerName(p.fullName || "");
    if (!incomingName || looksLikeCompanyName(incomingName) || isLabelName(incomingName)) return;

    const normalized: Passenger = {
      ...p,
      fullName: incomingName,
      cpf: cpfDigits,
      birthDate: p.birthDate || "",
      phone: p.phone || "",
      email: p.email || "",
      passport: p.passport || "",
      passportExpiry: p.passportExpiry || "",
    };

    const existing = map.get(cpfDigits);
    if (!existing) {
      map.set(cpfDigits, normalized);
      return;
    }

    // Merge: prefer the more complete record
    const existingWords = cleanSpacesLoose(existing.fullName).split(/\s+/).filter(Boolean).length;
    const incomingWords = cleanSpacesLoose(normalized.fullName).split(/\s+/).filter(Boolean).length;

    if (incomingWords > existingWords && isProbablyPersonName(normalized.fullName)) {
      existing.fullName = normalized.fullName;
    }

    if (!existing.birthDate && normalized.birthDate) existing.birthDate = normalized.birthDate;
    if (!existing.phone && normalized.phone) existing.phone = normalized.phone;
    if (!existing.email && normalized.email) existing.email = normalized.email;
    if (!existing.passport && normalized.passport) existing.passport = normalized.passport;
    if (!existing.passportExpiry && normalized.passportExpiry) existing.passportExpiry = normalized.passportExpiry;

    map.set(cpfDigits, existing);
  };

  // Primary format: "NOME COMPLETO, dd/mm/aaaa, CPF 000.000.000-00, ... "
  const rePrimary = new RegExp(
    `${NAME_CAPTURE}\\s*,\\s*(\\d{2}\\/\\d{2}\\/\\d{4})\\s*,\\s*CPF\\s*([0-9.\\- ]{11,14})`,
    "giu",
  );

  const scanText = tailFull;

  let m1: RegExpExecArray | null;
  while ((m1 = rePrimary.exec(scanText)) !== null) {
    const name = (m1[1] || "").trim();
    const birth = (m1[2] || "").trim();
    const cpfDigits = normalizeCPF(m1[3] || "");
    const window = scanText.slice(m1.index, Math.min(scanText.length, m1.index + 420));

    const phoneMatch = window.match(/\(\d{2}\)\s*\d{4,5}-\d{4}|\b\d{10,11}\b/);
    const emailMatch = window.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

    upsert({
      fullName: name,
      birthDate: toISODateFromBR(birth) || "",
      cpf: cpfDigits,
      phone: phoneMatch ? phoneMatch[0].trim() : "",
      email: emailMatch ? emailMatch[0].trim() : "",
      passport: "",
      passportExpiry: "",
    });
  }

  // Secondary format: "NOME ... CPF: ... Nasc: dd/mm/aaaa"
  const reSecondary = new RegExp(
    `${NAME_CAPTURE}[\\s\\S]{0,180}?\\bCPF\\b[:\\s]*([0-9.\\- ]{11,14})(?:[\\s\\S]{0,260}?\\bNasc\\b[:\\s]*(\\d{2}\\/\\d{2}\\/\\d{4}))?`,
    "giu",
  );

  let m2: RegExpExecArray | null;
  while ((m2 = reSecondary.exec(scanText)) !== null) {
    const name = (m2[1] || "").trim();
    const cpfDigits = normalizeCPF(m2[2] || "");
    const birth = (m2[3] || "").trim();
    const window = scanText.slice(m2.index, Math.min(scanText.length, m2.index + 460));

    const phoneMatch = window.match(/\(\d{2}\)\s*\d{4,5}-\d{4}|\b\d{10,11}\b/);
    const emailMatch = window.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

    upsert({
      fullName: name,
      birthDate: birth ? (toISODateFromBR(birth) || "") : "",
      cpf: cpfDigits,
      phone: phoneMatch ? phoneMatch[0].trim() : "",
      email: emailMatch ? emailMatch[0].trim() : "",
      passport: "",
      passportExpiry: "",
    });
  }
}

const lines = tail
    .split("\n")
    .map((l) => l.replace(/^[-•\u2022]+\s*/, "").trim())
    .filter(Boolean);

  // coletar linhas até começar outro bloco
  const passengerLines: string[] = [];

  // Some layouts render "Passageiros: X Adultos" and the first passenger on the same line.
  // Include line 0 if it already contains CPF data.
  if (lines[0] && /(\bCPF\b|\d{3}\.?(?:\d{3})\.?(?:\d{3})[-\s]?\d{2})/i.test(lines[0])) {
    passengerLines.push(lines[0]);
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) break;

    if (
      /^(Hotel|Hospedagem|Voo|Voos|Forma de pagamento|Localizador|Código:)/i.test(
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

  let pendingName = ""; // guarda nome quando vem em linha separada

  for (let i = 0; i < passengerLines.length; i++) {
    const raw = passengerLines[i];
    const line = raw.replace(/\s+/g, " ").trim();

    if (!line) continue;

    // ignora “Reservado por” e variações, e ignora empresas explícitas
    if (/^Reservado por\b/i.test(line)) {
      pendingName = "";
      continue;
    }
    // do not hardcode company names here; rely on looksLikeCompanyName() instead

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

    // telefone
    const phoneMatch = line.match(/\(\d{2}\)\s*\d{4,5}-\d{4}|\b\d{10,11}\b/);
    const phone = phoneMatch ? phoneMatch[0].trim() : "";

    // email
    const emailMatch = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const email = emailMatch ? emailMatch[0].trim() : "";

    // data nascimento (somente quando for claramente nascimento)
    const birthRaw = extractBirthFromPassengerLine(line);
    const birthDate = birthRaw ? (toISODateFromBR(birthRaw) || "") : "";

    // Se não conseguimos um nome válido, ainda assim mantenha o CPF no mapa
    // quando a página indica que há mais passageiros do que capturamos.
    const safeName = sanitizePassengerName(nameCandidate || "");
    if (!safeName || looksLikeCompanyName(safeName) || !isProbablyPersonName(safeName)) {
      if (expectedCount !== null) {
        const existing = map.get(cpfDigits);
        if (existing) {
          if (!existing.phone && phone) existing.phone = phone;
          if (!existing.email && email) existing.email = email;
          map.set(cpfDigits, existing);
        } else {
          map.set(cpfDigits, {
            fullName: "",
            birthDate: "",
            cpf: cpfDigits,
            phone: phone || "",
            email: email || "",
            passport: "",
            passportExpiry: "",
          });
        }
      }
      continue;
    }

    nameCandidate = safeName;

    // passaporte
    const passportMatch = line.match(/Passaporte[:\s]*([A-Z0-9-]+)/i);
    const passport = passportMatch ? passportMatch[1].trim() : "";

    const existing = map.get(cpfDigits);
    if (existing) {
      // Merge details when we see the same CPF again (common in inconsistent layouts)
      if (!existing.fullName || existing.fullName.length < nameCandidate.length) {
        existing.fullName = nameCandidate;
      }
      if (!existing.birthDate && birthDate) existing.birthDate = birthDate;
      if (!existing.phone && phone) existing.phone = phone;
      if (!existing.email && email) existing.email = email;
      if (!existing.passport && passport) existing.passport = passport;
      map.set(cpfDigits, existing);
      continue;
    }

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

  // Strong fallback: scan for CPF occurrences inside the passenger block and
  // infer the closest name before each CPF. We run this when:
  // - nothing was extracted, OR
  // - the page indicates more passengers than we found (common Azul/Latam layouts).
  // Se estiver faltando passageiro, faça o fallback no trecho mais amplo (tailFull).
  // Alguns layouts colocam o bloco azul de passageiros antes de "Voo de ida" e
  // podem conter textos que fariam o recorte (tail) perder linhas.
  const fallbackText = (expectedCount !== null && map.size < expectedCount) ? tailFull : tail;

  if (map.size === 0 || (expectedCount !== null && map.size < expectedCount)) {
    // More tolerant CPF matcher: accepts any separators between digit groups.
    const cpfRe = /(\d{3}\D*\d{3}\D*\d{3}\D*\d{2})/g;
    let m: RegExpExecArray | null;
    while ((m = cpfRe.exec(fallbackText)) !== null) {
      const cpfDigits = normalizeCPF(m[1]);
      if (cpfDigits.length !== 11) continue;
      const idx = m.index;
      const before = fallbackText.slice(Math.max(0, idx - 1100), idx);
      const after = fallbackText.slice(idx, Math.min(fallbackText.length, idx + 420));
      const localLine = getLineAroundIndex(fallbackText, idx);

      // Try to read the exact "NOME, dd/mm/aaaa, CPF" pattern from the line.
      // This avoids picking "Adultos" or "Passageiros" as part of the name.
      const reLocal = new RegExp(
        `${NAME_CAPTURE}\\s*,\\s*(\\d{2}\\/\\d{2}\\/\\d{4})\\s*,\\s*CPF\\b`,
        "iu",
      );
      const ml = localLine.match(reLocal);

      const rawName = ml ? (ml[1] || "") : bestNameFromContext(before);
      const rawBirth = ml ? (ml[2] || "") : birthNear(after);
      const birthDate = rawBirth ? (toISODateFromBR(rawBirth) || "") : "";

      const phoneMatch = after.match(/\(\d{2}\)\s*\d{4,5}-\d{4}|\b\d{10,11}\b/);
      const phone = phoneMatch ? phoneMatch[0].trim() : "";

      const emailMatch = after.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const email = emailMatch ? emailMatch[0].trim() : "";

      const nameCandidate = sanitizePassengerName(rawName);

      // Even if name is not found, keep CPF as placeholder when we expect more passengers.
      if (!nameCandidate || looksLikeCompanyName(nameCandidate) || !isProbablyPersonName(nameCandidate)) {
        if (expectedCount !== null) {
          const existing = map.get(cpfDigits);
          if (existing) {
            if (!existing.phone && phone) existing.phone = phone;
            if (!existing.email && email) existing.email = email;
            map.set(cpfDigits, existing);
          } else {
            map.set(cpfDigits, {
              fullName: "",
              birthDate: "",
              cpf: cpfDigits,
              phone: phone || "",
              email: email || "",
              passport: "",
              passportExpiry: "",
            });
          }
        }
        continue;
      }

      const existing = map.get(cpfDigits);
      if (existing) {
        if (!existing.fullName || existing.fullName.length < nameCandidate.length) {
          existing.fullName = nameCandidate;
        }
        if (!existing.birthDate && birthDate) existing.birthDate = birthDate;
        if (!existing.phone && phone) existing.phone = phone;
        if (!existing.email && email) existing.email = email;
        map.set(cpfDigits, existing);
      } else {
        map.set(cpfDigits, {
          fullName: nameCandidate,
          birthDate: birthDate || "",
          cpf: cpfDigits,
          phone: phone || "",
          email: email || "",
          passport: "",
          passportExpiry: "",
        });
      }
    }
  }

  // Pós-processamento: quando o nome veio como 1 palavra (ex: "Victor"),
  // tentar promover para nome completo usando o CPF como chave.
  // Isso melhora bastante a assertividade em alguns layouts do IDDAS.
  const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const cpfToFlexiblePattern = (cpfDigits: string) => {
    // Constrói um padrão que aceita pontuação e espaços entre os blocos do CPF
    // Ex: 12345678900 -> 123\D*456\D*789\D*00
    const d = (cpfDigits || "").replace(/\D/g, "");
    if (d.length !== 11) return "";
    const a = d.slice(0, 3);
    const b = d.slice(3, 6);
    const c = d.slice(6, 9);
    const e = d.slice(9, 11);
    return `${escapeRe(a)}\\D*${escapeRe(b)}\\D*${escapeRe(c)}\\D*${escapeRe(e)}`;
  };

  const improveText = tailFull;

  const findBestNameAndBirthByCpf = (cpfDigits: string) => {
    const cpfFlex = cpfToFlexiblePattern(cpfDigits);
    if (!cpfFlex) return { name: "", birth: "" };

        const patterns: RegExp[] = [
          // "NOME COMPLETO, dd/mm/aaaa, CPF xxx"
          new RegExp(
            `${NAME_CAPTURE}\\s*,\\s*(\\d{2}\\/\\d{2}\\/\\d{4})\\s*,\\s*CPF\\s*${cpfFlex}`,
            "iu",
          ),
          // "NOME COMPLETO ... CPF: xxx ... Nasc: dd/mm/aaaa"
          new RegExp(
            `${NAME_CAPTURE}[\\s\\S]{0,180}?\\bCPF\\b[:\\s]*${cpfFlex}(?:[\\s\\S]{0,260}?\\bNasc\\b[:\\s]*(\\d{2}\\/\\d{2}\\/\\d{4}))?`,
            "iu",
          ),
          // "CPF: xxx" e procurar nome completo imediatamente antes
          new RegExp(
            `${NAME_CAPTURE}\\s*[,;:]?\\s*CPF\\s*[:\\s]*${cpfFlex}`,
            "iu",
          ),
        ];

    let bestName = "";
    let bestBirth = "";

    for (const re of patterns) {
      const m = improveText.match(re);
      if (!m) continue;
      const name = (m[1] || "").trim();
      const birth = (m[2] || "").trim();
      if (!name || looksLikeCompanyName(name) || isLabelName(name)) continue;

      const wordCount = name.split(/\\s+/).filter(Boolean).length;
      const bestWordCount = bestName
        ? bestName.split(/\\s+/).filter(Boolean).length
        : 0;

      if (wordCount >= 2 && wordCount >= bestWordCount) {
        bestName = name;
        if (birth) bestBirth = birth;
      }
    }

    return { name: bestName, birth: bestBirth };
  };

  for (const [cpf, p] of map.entries()) {
    const currentName = (p.fullName || "").trim();
    const words = currentName.split(/\s+/).filter(Boolean);

    const improved = findBestNameAndBirthByCpf(cpf);

    // Se o nome atual está incompleto (poucas palavras), tente promover para um nome mais completo.
    if (improved.name) {
      const improvedWords = improved.name.split(/\s+/).filter(Boolean).length;
      const currentWords = words.length;
      if (currentWords < 2 || improvedWords > currentWords) {
        p.fullName = improved.name;
      }
    }

    // Data de nascimento: só preenche se a extração encontrou um valor claro.
    if (!p.birthDate && improved.birth) {
      p.birthDate = toISODateFromBR(improved.birth) || "";
    }
  }

  return Array.from(map.values());
}


function parseDateBRToISO(dateBR: string): string | null {
  const m = dateBR.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  const d = Number(dd), mo = Number(mm), y = Number(yyyy);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeCpf(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length >= 11 ? digits.slice(-11) : digits;
}

// DOM-based passenger extraction for IDDAS.
// IMPORTANT: keep a single declaration. Deno Edge Runtime fails to boot if duplicated.
function extractPassengersFromDom(doc: any): Passenger[] {
  try {
    const passengerEls = Array.from(doc?.querySelectorAll?.('p.fs-6') || []);
    const byKey = new Map<string, Passenger>();

    for (const el of passengerEls) {
      const txt = (el?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/\bCPF\b/i.test(txt)) continue;

      const nameEl = el?.querySelector?.('span.fw-semibold');
      const fullName = (nameEl?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!fullName) continue;

      const cpfMatch = txt.match(/\bCPF\s*([0-9.\-]{11,})/i);
      const birthMatch = txt.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);

      const cpf = normalizeCPF(cpfMatch?.[1] || '');
      const birthDate = birthMatch?.[1] ? (toISODateFromBR(birthMatch[1]) || '') : '';

      const key = cpf && cpf.length === 11 ? `cpf:${cpf}` : `name:${fullName.toUpperCase()}`;
      if (byKey.has(key)) continue;

      byKey.set(key, {
        fullName,
        birthDate,
        cpf: cpf && cpf.length === 11 ? cpf : '',
        phone: '',
        email: '',
        passport: '',
        passportExpiry: '',
      });
    }

    return Array.from(byKey.values());
  } catch (_) {
    return [];
  }
}

function matchAllHotelsFromDom(doc: any): ExtractedHotel[] {
  try {
    const results: ExtractedHotel[] = [];

    // The most reliable anchor is the reservation badge (Número da Reserva)
    const badges = Array.from(doc.querySelectorAll('span.badge'));
    for (const b of badges) {
      const title = (b.getAttribute?.('data-bs-original-title') || '').toLowerCase();
      const badgeText = (b.textContent || '').replace(/\s+/g, ' ').trim();

      if (!title.includes('reserva') || !title.includes('hosped')) continue;
      if (!badgeText) continue;

      // Walk up to the hotel row container
      let node: any = b;
      while (node && node.tagName !== 'BODY') {
        const cls = (node.getAttribute?.('class') || '');
        if (cls.includes('row') && cls.includes('mb-1')) break;
        node = node.parentElement;
      }
      if (!node) continue;

      const nameEl = node.querySelector('h6.hDescricao');
      const rawName = (nameEl?.textContent || '').replace(/\s+/g, ' ').trim();
      const name = rawName.replace(/\s*★\s*/g, ' ').trim() || rawName;

      // Address (optional)
      const addrEl = node.querySelector('a[href*="google.com/maps"]');
      const address = (addrEl?.textContent || '').replace(/\s+/g, ' ').trim();

      // Dates are usually in the right column: "DD/MM/YYYY 14h -> DD/MM/YYYY"
      const rightText = (node.textContent || '').replace(/\s+/g, ' ');
      const dateMatches = rightText.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [];
      const checkInBR = dateMatches[0];
      const checkOutBR = dateMatches[1];

      const checkIn = parseDateBRToISO(checkInBR || '') || undefined;
      const checkOut = parseDateBRToISO(checkOutBR || '') || undefined;

      results.push({
        name: name || 'Hospedagem',
        checkIn,
        checkOut,
        confirmationCode: badgeText,
        address: address || undefined,
        rawText: node.textContent || '',
      });
    }

    // Deduplicate by confirmation code
    const byCode = new Map<string, ExtractedHotel>();
    for (const h of results) {
      const key = h.confirmationCode || `${h.name}|${h.checkIn}|${h.checkOut}`;
      if (!byCode.has(key)) byCode.set(key, h);
    }
    return Array.from(byCode.values());
  } catch (_) {
    return [];
  }
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
  const corsHeaders = buildCorsHeaders(req);
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

	    const fetchHtmlOnce = async (attempt: number) => {
  const headers = new Headers();
  headers.set(
    "user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
  );
  headers.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  headers.set("accept-language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7");
  headers.set("cache-control", "no-cache");
  headers.set("pragma", "no-cache");
  if (attempt >= 2) headers.set("referer", url);

  const controller = new AbortController();
  const timeoutMs = attempt === 1 ? 12000 : 18000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
};

let pageText = "";
let doc: Document | null = null;
let passengers: Passenger[] = [];
let lastStatus = 0;

for (let attempt = 1; attempt <= 2; attempt++) {
  const r = await fetchHtmlOnce(attempt);
  lastStatus = r.status;

  if (!r.ok) {
    if (attempt === 2) {
      return new Response(JSON.stringify({ success: false, error: `Falha ao buscar URL (${r.status})` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    continue;
  }

  const html = await r.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const rawText = extractTextWithNewlines(parsed) || parsed?.body?.textContent || "";
  const normalized = normalizeText(rawText);

  // Alternate text extraction directly from raw HTML. Some layouts hide or collapse
  // parts of the passenger block when relying only on textContent.
  const normalizedFromHtml = htmlToText(html);

  const passengersA = extractPassengers(normalized);
  const passengersB = normalizedFromHtml ? extractPassengers(normalizedFromHtml) : [];

  const expectedCount = getExpectedPassengerCount(normalized) ?? getExpectedPassengerCount(normalizedFromHtml);

  const score = (ps: Passenger[]) => {
    const full = ps.filter((p) => (p.fullName || "").trim().split(/\s+/).filter(Boolean).length >= 2).length;
    const birth = ps.filter((p) => !!p.birthDate).length;
    return ps.length * 1000 + full * 10 + birth * 5;
  };

  let extractedPassengers = passengersA;
  if (score(passengersB) > score(extractedPassengers)) extractedPassengers = passengersB;
  if (expectedCount !== null) {
    // Prefer the result that meets expected passenger count
    if (passengersA.length >= expectedCount && passengersB.length < expectedCount) extractedPassengers = passengersA;
    if (passengersB.length >= expectedCount && passengersA.length < expectedCount) extractedPassengers = passengersB;
  }


  // DOM-based extraction for IDDAS passenger banner (more reliable for names with suffix like "(BR4)")
  const passengersDom = extractPassengersFromDom(parsed);
  if (passengersDom.length) {
    const merged = new Map<string, Passenger>();
    const upsertMerged = (p: Passenger) => {
      const cpfDigits = normalizeCPF(p.cpf);
      if (cpfDigits.length !== 11) return;
      const existing = merged.get(cpfDigits) || { ...p, cpf: cpfDigits };
      const incomingName = sanitizePassengerName(p.fullName || "");
      if (incomingName && (!existing.fullName || !isProbablyPersonName(existing.fullName))) {
        existing.fullName = incomingName;
      }
      if (!existing.birthDate && p.birthDate) existing.birthDate = p.birthDate;
      if (!existing.phone && p.phone) existing.phone = p.phone;
      if (!existing.email && p.email) existing.email = p.email;
      merged.set(cpfDigits, existing);
    };

    for (const p of extractedPassengers) upsertMerged(p);
    for (const p of passengersDom) upsertMerged(p);

    extractedPassengers = Array.from(merged.values());
  }

  // Retry when the HTML is likely incomplete (happens with aggressive caching)
  const shouldRetry =
    !parsed ||
    normalized.length < 3000 ||
    extractedPassengers.length === 0 ||
    (expectedCount !== null && extractedPassengers.length < expectedCount);

  pageText = normalized;
  doc = parsed;
  passengers = extractedPassengers;

  if (!shouldRetry) break;
}

if (!pageText || !doc) {
  return new Response(JSON.stringify({ success: false, error: `Falha ao processar HTML (${lastStatus})` }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const total = parseMoneyBRL(pageText);
const reservedBy = extractReservedBy(pageText);
    
    // mainPassengerName is ALWAYS the first passenger real, otherwise empty
    const mainPassengerName = passengers.length > 0 ? passengers[0].fullName : "";
    
    const flights = matchAllFlights(pageText, mainPassengerName);
    const hotelsText = matchAllHotels(pageText) || [];
    const hotelsMerged = [...(hotelsDom || []), ...hotelsText];

    const hotelSeen = new Set<string>();
    const hotels: ExtractedHotel[] = [];
    for (const h of hotelsMerged) {
      const key = h.confirmationCode || `${h.name}|${h.checkIn || ''}|${h.checkOut || ''}`;
      if (hotelSeen.has(key)) continue;
      hotelSeen.add(key);
      hotels.push(h);
    }
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
