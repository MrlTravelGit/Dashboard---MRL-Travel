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
import { requireAuthenticatedUser } from "../_shared/auth.ts";
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
function maskSensitiveForDebug(s: string): string {
  let out = s || "";
  // Mask CPF formats like 000.000.000-00
  out = out.replace(/\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g, "***.***.***-$4");
  // Mask raw 11-digit sequences that likely represent CPF
  out = out.replace(/\b(\d{11})\b/g, (m) => `${m.slice(0, 3)}********`);
  // Mask emails (keep domain)
  out = out.replace(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi, (_m, domain) => `***@${domain}`);
  // Mask phone numbers (keep last 2 digits)
  out = out.replace(/(\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4})/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 8) return "***";
    return `(**) *****-**${digits.slice(-2)}`;
  });
  return out;
}
function extractContext(text: string, needles: string[], radius: number): string {
  const t = text || "";
  if (!t) return "";
  let idx = -1;
  for (const n of needles) {
    const i = t.toLowerCase().indexOf((n || "").toLowerCase());
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) idx = 0;
  const start = Math.max(0, idx - radius);
  const end = Math.min(t.length, idx + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < t.length ? "..." : "";
  return prefix + t.slice(start, end) + suffix;
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

// ---------------------------------------------------------------------------
// NOVO PARSER DE VOOS POR DOM — versão card-by-card
// ---------------------------------------------------------------------------
// Estratégia:
//   1. Encontra cada <section> que contém o título "Transporte Aéreo".
//   2. Dentro de cada section, isola o card visual principal
//      (div.rounded-2xl.bg-slate-50) que contém os IATAs e datas do voo.
//   3. Extrai campos diretamente dos nós DOM, evitando misturar dados de
//      passageiros, hotel ou carro.
//   4. Valida: precisa de ≥ 2 IATAs distintos + ao menos uma data ≥ 2000.
//   5. Retorna [] se não encontrar nada no novo layout → chamador usa
//      matchAllFlights() como fallback (layout antigo).
// ---------------------------------------------------------------------------

function extractFlightsFromDom(doc: any, mainPassengerName: string, debugMode = false): ExtractedFlight[] {
  try {
    const body = doc?.body;
    if (!body) return [];

    // Helper: texto limpo de um elemento (sem scripts/styles)
    const elText = (el: any): string => {
      if (!el) return '';
      const walk = (node: any): string => {
        if (!node) return '';
        if (node.nodeType === 3) return (node.nodeValue || '').replace(/\s+/g, ' ');
        const tag = (node.tagName || '').toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
        return Array.from(node.childNodes || []).map(walk).join('');
      };
      return walk(el).replace(/\s+/g, ' ').trim();
    };

    // Helper: texto inline de um nó (apenas filhos diretos de texto)
    const directText = (el: any): string => {
      let out = '';
      for (const c of Array.from(el?.childNodes || [])) {
        if ((c as any).nodeType === 3) out += (c as any).nodeValue || '';
      }
      return out.replace(/\s+/g, ' ').trim();
    };

    // Encontra seções de "Transporte Aéreo": pode ser <section> ou qualquer
    // elemento que contenha esse texto em h2/p/div imediato.
    const flightSections: any[] = [];
    const allSections = Array.from(body.querySelectorAll('section') as any[]);
    for (const sec of allSections) {
      const t = elText(sec);
      if (/Transporte\s+A[eé]reo/i.test(t) && /\([A-Z]{3}\)/.test(t)) {
        flightSections.push(sec);
      }
    }

    // Fallback: se não houver <section>, procurar em divs grandes
    if (flightSections.length === 0) {
      const allDivs = Array.from(body.querySelectorAll('div') as any[]);
      for (const div of allDivs) {
        const t = elText(div);
        if (/Transporte\s+A[eé]reo/i.test(t) && /\([A-Z]{3}\)/.test(t)) {
          // Evita aninhar: só adiciona se nenhum ancestral já foi adicionado
          const alreadyIncluded = flightSections.some((s: any) => s.contains(div) || div.contains(s));
          if (!alreadyIncluded) flightSections.push(div);
        }
      }
    }

    if (debugMode) {
      console.log(`[extractFlightsFromDom] flight sections found: ${flightSections.length}`);
    }

    if (flightSections.length === 0) return [];

    // --- Parse de cada seção ---
    const results: ExtractedFlight[] = [];
    const seenDedup = new Set<string>();

    for (let si = 0; si < flightSections.length; si++) {
      const sec = flightSections[si];
      const secText = elText(sec);

      // Detecta tipo (ida/volta) pelo subtítulo da section
      const typeHint: 'outbound' | 'return' | 'unknown' =
        /Voo de Volta/i.test(secText) ? 'return' :
        /Voo de Ida/i.test(secText) ? 'outbound' :
        'unknown';

      // Detecta companhia aérea pela imagem alt ou src
      let airline = '';
      const imgs = Array.from(sec.querySelectorAll('img') as any[]);
      for (const img of imgs) {
        const src = ((img?.getAttribute?.('src') || '') + ' ' + (img?.getAttribute?.('alt') || '')).toUpperCase();
        if (src.includes('AZUL')) { airline = 'AZUL'; break; }
        if (src.includes('LATAM') || src.includes('/LA')) { airline = 'LATAM'; break; }
        if (src.includes('GOL') || src.includes('/G3')) { airline = 'GOL'; break; }
      }
      if (!airline) airline = inferAirline(secText);

      // Detecta localizador: badge com classe bg-blue-100 ou texto "Localizador"
      let locator = '';
      const badges = Array.from(sec.querySelectorAll('span') as any[]);
      for (const b of badges) {
        const cls = (b?.getAttribute?.('class') || '').toString();
        if (/bg-blue-100|bg-blue-50/.test(cls)) {
          const t = elText(b).trim();
          if (/^[A-Z0-9]{5,10}$/.test(t)) { locator = t; break; }
        }
      }
      if (!locator) {
        const locM = secText.match(/Localizador\s*[:\s]*([A-Z0-9]{5,14})/i);
        if (locM) locator = locM[1];
      }

      // Encontra o card visual principal do voo dentro da section
      // (div.rounded-2xl.bg-slate-50 que tenha IATAs)
      const cardCandidates = Array.from(sec.querySelectorAll('div') as any[]).filter((d: any) => {
        const cls = (d?.getAttribute?.('class') || '').toString();
        const t = elText(d);
        return /rounded-2xl/.test(cls) && /bg-slate-50/.test(cls) && /\([A-Z]{3}\)/.test(t);
      });

      // Se não encontrou card específico, usa a própria section como card
      const card = cardCandidates.length > 0 ? cardCandidates[0] : sec;
      const cardText = elText(card);

      if (debugMode) {
        console.log(`[extractFlightsFromDom] section ${si}: type=${typeHint}, airline=${airline}, locator=${locator}`);
        console.log(`[extractFlightsFromDom] cardText: ${cardText.slice(0, 300)}`);
      }

      // --- Extrai pares Cidade (IATA) ---
      const cityIataRx = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.\-]{1,}?)\s*\(([A-Z]{3})\)/g;
      const pairs: { city: string; code: string }[] = [];
      let cm: RegExpExecArray | null;
      while ((cm = cityIataRx.exec(cardText)) !== null) {
        const city = cm[1].trim();
        const code = cm[2].trim();
        // Filtra cidades claramente inválidas (ex: capturou lixo antes do IATA)
        if (city.length > 1 && !/^\d+$/.test(city)) {
          pairs.push({ city, code });
        }
      }

      if (debugMode) {
        console.log(`[extractFlightsFromDom] section ${si}: IATAs detected: ${pairs.map(p => p.code).join(',')}`);
      }

      // Precisa de pelo menos 2 IATAs diferentes
      if (pairs.length < 2) continue;
      const origin = pairs[0];
      let dest: { city: string; code: string } | null = null;
      for (let pi = pairs.length - 1; pi >= 0; pi--) {
        if (pairs[pi].code !== origin.code) { dest = pairs[pi]; break; }
      }
      if (!dest) continue;

      // --- Extrai datas — SOMENTE dentro do card do voo, jamais data de Nasc ---
      // Busca datas brutas com ano >= 2020 e ignora contexto de nascimento/CPF
      const rawDateMatches = Array.from(cardText.matchAll(/\b(\d{2}\/\d{2}\/(\d{4}))\b/g));
      const validDates = rawDateMatches
        .map(m => ({ val: m[1], year: Number(m[2]), idx: (m as any).index ?? 0 }))
        .filter(d => {
          if (d.year < 2020) return false; // Jamais datas antigas (nascimento é sempre < 2000s para adultos)
          // Verifica contexto imediato no cardText
          const ctx = cardText.slice(Math.max(0, d.idx - 30), d.idx + 30).toLowerCase();
          if (/nasc|nascimento|cpf|passaport|rg\b/.test(ctx)) return false;
          return true;
        })
        .map(d => d.val);

      if (debugMode) {
        console.log(`[extractFlightsFromDom] section ${si}: valid dates: ${validDates.join(', ')}`);
      }

      if (validDates.length === 0) continue;

      // Data de partida = primeira data válida; chegada = última (se diferente)
      const departureDate = validDates[0];
      const arrivalDate = validDates[validDates.length - 1] !== departureDate
        ? validDates[validDates.length - 1]
        : validDates[0];

      // --- Extrai horários usando a estrutura DOM do card ---
      // O layout IDDAS usa um flex-row com 3 filhos:
      //   [0] coluna esquerda: data + horário de PARTIDA + cidade origem
      //   [1] coluna central:  duração + "Voo direto XXXX"   ← NÃO é horário real
      //   [2] coluna direita:  data + horário de CHEGADA + cidade destino
      // Estratégia: encontrar o div com o padrão flex que contém ambos os IATAs
      // e extrair horários do primeiro e último filho, ignorando o filho central.
      let departureTime = '';
      let arrivalTime = '';
      (() => {
        // Procura o div flex-row pai que tem os dois IATAs (origem e destino)
        const allDivs = Array.from(card.querySelectorAll('div') as any[]);
        for (const d of allDivs) {
          const cls = (d?.getAttribute?.('class') || '').toString();
          // O contêiner flex tem "flex" e "items-center" e "gap-"
          if (!/flex/.test(cls)) continue;
          const children = Array.from(d.childNodes || []).filter(
            (c: any) => c.nodeType === 1 && (c.tagName || '').toLowerCase() === 'div'
          ) as any[];
          if (children.length < 3) continue;
          const leftText  = elText(children[0]);
          const rightText = elText(children[children.length - 1]);
          // Valida: filho esquerdo e direito devem conter IATA
          if (!/\([A-Z]{3}\)/.test(leftText) || !/\([A-Z]{3}\)/.test(rightText)) continue;
          // Extrai horário da coluna esquerda (partida) — primeiro match
          const depM = leftText.match(/\b(\d{2}h\d{2}|\d{2}h)\b/);
          if (depM) departureTime = depM[1];
          // Extrai horário da coluna direita (chegada) — primeiro match
          const arrM = rightText.match(/\b(\d{2}h\d{2}|\d{2}h)\b/);
          if (arrM) arrivalTime = arrM[1];
          break; // achou o contêiner correto
        }
        // Fallback: se não conseguiu pelo DOM, usa texto mas pula a duração
        // (descarta horários que aparecem junto com "direto" ou "Voo")
        if (!departureTime || !arrivalTime) {
          const allTimes = Array.from(cardText.matchAll(/\b(\d{2}h\d{2}|\d{2}h)\b/g))
            .map(m => ({ val: m[1], idx: (m as any).index ?? 0 }))
            .filter(t => {
              // Remove horário se estiver no contexto de duração (vizinho de "direto", "Voo", "h" isolado pequeno)
              const ctx = cardText.slice(Math.max(0, t.idx - 40), t.idx + 40);
              const isDuration = /direto|Voo\s+direto/i.test(ctx);
              return !isDuration;
            });
          if (!departureTime && allTimes[0]) departureTime = allTimes[0].val;
          if (!arrivalTime && allTimes[1]) arrivalTime = allTimes[1].val;
        }
      })();

      // --- Extrai número do voo ---
      // Suporta: "Voo direto 2474", "Voo direto LA3053", "Voo direto AD2474", número isolado no card
      let flightNumber = '';
      const directMatch = cardText.match(/Voo\s+direto\s+([A-Z]{0,3}\s?\d{3,4})/i);
      if (directMatch) {
        flightNumber = directMatch[1].replace(/\s+/g, '').replace(/^[A-Z]{1,3}(?=\d)/, '');
        // Guarda o prefixo de companhia se airline ainda não encontrada
        if (!airline) {
          const pfx = directMatch[1].replace(/\s+/g, '').match(/^([A-Z]{2,3})\d/)?.[1];
          if (pfx) airline = inferAirline(pfx) || pfx;
        }
      } else {
        // Fallback: número isolado na linha "Voo direto\n1234"
        const numM = cardText.match(/\bVoo\s+direto\s*\n?\s*(\d{3,4})\b/i)
          || cardText.match(/\b(\d{4})\s*\n/);
        if (numM) flightNumber = numM[1];
      }

      // --- Tipo da viagem (ida/volta) ---
      const type: 'outbound' | 'return' =
        typeHint !== 'unknown' ? typeHint :
        results.length === 0 ? 'outbound' : 'return';

      // --- Deduplicação ---
      const dedupeKey = `${airline}|${flightNumber}|${departureDate}|${origin.code}|${dest.code}`;
      if (seenDedup.has(dedupeKey)) {
        if (debugMode) console.log(`[extractFlightsFromDom] deduped: ${dedupeKey}`);
        continue;
      }
      seenDedup.add(dedupeKey);

      results.push({
        airline,
        flightNumber,
        origin: origin.city,
        originCode: origin.code,
        destination: dest.city,
        destinationCode: dest.code,
        departureDate,
        departureTime,
        arrivalDate,
        arrivalTime,
        locator,
        passengerName: mainPassengerName || '',
        type,
        stops: 0,
        id: `${locator || 'NOLOC'}:${flightNumber || 'NOVOO'}:${results.length}`,
      });
    }

    if (debugMode) {
      console.log(`[extractFlightsFromDom] total flights extracted: ${results.length}`);
    }

    return results;
  } catch (e) {
    console.error('[extractFlightsFromDom] error:', e);
    return [];
  }
}

// Mantida para compatibilidade interna (usada como fallback de texto para layouts antigos)
function extractFlightSectionText(doc: any): string {
  try {
    const body = doc?.body;
    if (!body) return "";

    const isBlockTag = (tag: string) => {
      const t = (tag || '').toLowerCase();
      return ['p','div','section','article','li','ul','ol','table','tr','td','th','header','footer','main','h1','h2','h3','h4','h5','h6','br'].includes(t);
    };
    const elementToTextTS = (root: any) => {
      let out = '';
      const walk = (node: any) => {
        if (!node) return;
        const nt = node.nodeType;
        if (nt === 3) {
          const v = (node.nodeValue || '').replace(/\s+/g, ' ');
          if (v.trim()) out += v;
          return;
        }
        if (nt !== 1) return;
        const tag = (node.tagName || '').toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
        if (tag === 'br') { out += '\n'; return; }
        const children = Array.from(node.childNodes || []);
        const beforeLen = out.length;
        for (const c of children) walk(c);
        if (isBlockTag(tag)) { if (out.length > beforeLen) out += '\n'; }
      };
      walk(root);
      return out;
    };

    // Seções de "Transporte Aéreo" com IATAs
    const secs: any[] = [];
    for (const sec of Array.from(body.querySelectorAll('section, div') as any[])) {
      const t = (sec?.textContent || '').replace(/\s+/g, ' ').trim();
      if (/Transporte\s+A[eé]reo/i.test(t) && /\([A-Z]{3}\)/.test(t)) {
        const alreadyIn = secs.some((s: any) => s.contains(sec) || sec.contains(s));
        if (!alreadyIn) secs.push(sec);
      }
    }
    if (secs.length === 0) return "";
    return secs.map((s) => elementToTextTS(s)).join('\n');
  } catch {
    return '';
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
  reservationUrl?: string;
};
// Try to capture airline reservation links embedded in the Iddas page (often used in QR codes).
// We keep it heuristic-based and safe (returns []).
function extractAirlineReservationLinks(doc: any): string[] {
  try {
    if (!doc) return [];
    const anchors = doc.querySelectorAll?.("a[href]") || [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const a of anchors) {
      const href = (a?.getAttribute?.("href") || "").toString().trim();
      if (!href) continue;
      const isLatam = /latamairlines\.com\//i.test(href);
      const isGol = /voegol\.com\.br\//i.test(href);
      if (!isLatam && !isGol) continue;
      const looksLikeReservation =
        /minhas-viagens\/(second-detail|encontrar-viagem)/i.test(href) ||
        /minhas-viagens\?/i.test(href);
      if (!looksLikeReservation) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push(href);
    }
    return out;
  } catch {
    return [];
  }
}
function matchAllFlights(pageText: string, mainPassengerName: string): ExtractedFlight[] {
  // Estratégia em camadas:
  // 1) Tentativa por cabeçalho "Voo de X (ABC) para Y (DEF)" (variantes com/sem parênteses).
  // 2) Fallback por blocos ao redor de "Voo direto XX1234" / "Voo XX1234" e padrões de data/hora + (IATA).
  // Motivo: o IDDAS muda com frequência o texto do cabeçalho e a estrutura visual.
  const flights: ExtractedFlight[] = [];
  const normalized = (pageText || "")
    .replace(/ /g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\r/g, "")
    .trim();
  // ---------------------------
  // Camada 1: cabeçalho clássico
  // ---------------------------
  const headerRegex =
    /Voo de\s+(.+?)\s*(?:\(|\s)([A-Z]{3})(?:\)|\s)\s+para\s+(.+?)\s*(?:\(|\s)([A-Z]{3})(?:\)|\s)/g;
  const indices: {
    start: number;
    origin: string;
    originCode: string;
    destination: string;
    destinationCode: string;
  }[] = [];
  let mh: RegExpExecArray | null;
  while ((mh = headerRegex.exec(normalized)) !== null) {
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
    const end = i + 1 < indices.length ? indices[i + 1].start : normalized.length;
    const block = normalized.slice(start, end);
    const dep = block.match(/Partida\s+([0-3]\d\/[0-1]\d\/\d{4})\s+(\d{2}h\d{2}|\d{2}h)/i);
    const arr = block.match(/Chegada\s+([0-3]\d\/[0-1]\d\/\d{4})\s+(\d{2}h\d{2}|\d{2}h)/i);
    const voo = block.match(/\bVoo\b\s+(\d{3,4})/i);
    const loc =
      block.match(/Localizador\s+([A-Z0-9]{5,14})/i)?.[1] ||
      block.match(/\b[A-Z0-9]{6,14}\b/)?.[0] ||
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
      stops: /Voo direto/i.test(block) ? 0 : 0,
      id,
    });
  }
  if (flights.length > 0) return flights;
  // -------------------------------------------
  // Camada 2: fallback por blocos (mais robusto)
  // -------------------------------------------
  // Quebra por linhas (regex corrigido)
  const lines = normalized.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // Padrões típicos que aparecem no texto do IDDAS
  const flightCodeRegex = /\b([A-Z]{2,3}\s?\d{3,4})\b/; // LA3053, G31239, AD 2472
  const flightNumberOnlyRegex = /\bVoo\b\s*(\d{3,4})\b/i;
  const directRegex = /Voo\s+direto\s+([A-Z]{2,3}\s?\d{3,4}|\d{3,4})/i;
  const cityIataRegex = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{2,})\s*\(([A-Z]{3})\)/g;
  function pickCityPairs(blockText: string) {
    const found: { city: string; code: string }[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = cityIataRegex.exec(blockText)) !== null) {
      found.push({ city: mm[1].trim(), code: mm[2].trim() });
    }
    cityIataRegex.lastIndex = 0;

    // Precisamos de pelo menos 2 IATAs diferentes para montar um voo
    const first = found[0];
    if (!first) return { origin: null as any, destination: null as any };

    let lastDistinct: { city: string; code: string } | null = null;
    for (let i = found.length - 1; i >= 0; i--) {
      if (found[i].code !== first.code) {
        lastDistinct = found[i];
        break;
      }
    }
    if (!lastDistinct) return { origin: null as any, destination: null as any };

    return { origin: first, destination: lastDistinct };
  }
  function pickDateTimes(blockText: string) {
    const dateMatches = Array.from(blockText.matchAll(/\b([0-3]\d\/[0-1]\d\/\d{4})\b/g)).map((m) => ({
      value: m[1],
      index: (m as any).index ?? -1,
    }));

    // Filtra datas que claramente são de passageiro (Nasc, CPF, passaporte) e datas antigas (ex: 1973)
    const filteredDates = dateMatches.filter((d) => {
      const y = Number(d.value.slice(-4));
      if (!Number.isFinite(y) || y < 2000) return false;
      const ctx = blockText.slice(Math.max(0, d.index - 20), Math.min(blockText.length, d.index + 20)).toLowerCase();
      if (ctx.includes("nasc") || ctx.includes("cpf") || ctx.includes("passaport")) return false;
      return true;
    });

    const datesOnly = (filteredDates.length ? filteredDates : dateMatches.filter((d) => {
      const y = Number(d.value.slice(-4));
      return Number.isFinite(y) && y >= 2000;
    })).map((d) => d.value);

    // Escolhe a data mais frequente no bloco (no card de voo ela aparece 2x)
    const counts = new Map<string, number>();
    for (const dt of datesOnly) counts.set(dt, (counts.get(dt) || 0) + 1);
    let bestDate = "";
    let bestCount = 0;
    for (const [dt, c] of counts.entries()) {
      if (c > bestCount) {
        bestCount = c;
        bestDate = dt;
      }
    }

    const times = Array.from(blockText.matchAll(/\b(\d{2}h\d{2}|\d{2}h)\b/g)).map((m) => m[1]);

    return {
      depDate: bestDate || datesOnly[0] || "",
      arrDate: bestDate || datesOnly[1] || datesOnly[0] || "",
      depTime: times[0] || "",
      arrTime: times[1] || "",
    };
  }
  function pickLocator(blockText: string) {
    return (
      blockText.match(/Localizador\s*[:\s]*([A-Z0-9]{5,14})/i)?.[1] ||
      blockText.match(/\b[A-Z0-9]{10,14}\b/)?.[0] || // ex: LA9576941GESM
      blockText.match(/\b[A-Z0-9]{6,9}\b/)?.[0] ||
      ""
    );
  }
  function normalizeFlightCode(code: string) {
    return (code || "").replace(/\s+/g, "").toUpperCase();
  }
  const candidates: ExtractedFlight[] = [];
  const seenKey = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // gatilho: linha com "Voo direto ..." ou com um código tipo LA3053 ou com "Voo 3053"
    const direct = line.match(directRegex)?.[1] || "";
    const code = direct || line.match(flightCodeRegex)?.[1] || "";
    const numOnly = !code ? line.match(flightNumberOnlyRegex)?.[1] || "" : "";
    const hasTrigger = !!(direct || code || numOnly);
    if (!hasTrigger) continue;
    const from = Math.max(0, i - 18);
    const to = Math.min(lines.length, i + 20);
    const blockText = lines.slice(from, to).join("\n");
    const airlineGuess = (inferAirline(blockText) as any) || lastAirline || "";
    if (airlineGuess) lastAirline = airlineGuess;
    const flightCode = normalizeFlightCode(code);
    const flightNumber = flightCode
      ? flightCode.replace(/^[A-Z]{2,3}/, "")
      : (numOnly || (direct ? direct.replace(/\s+/g, "").replace(/^[A-Z]{2,3}/, "") : "") || "");
    const { origin, destination } = pickCityPairs(blockText);
    if (!origin || !destination) continue;
    const dt = pickDateTimes(blockText);
    if (!dt.depDate) continue;
    const locator = pickLocator(blockText);
    const type: "outbound" | "return" =
      /\bVolta\b|\bRetorno\b/i.test(blockText) ? "return" :
      /\bIda\b/i.test(blockText) ? "outbound" :
      candidates.length === 0 ? "outbound" : "return";
    const key = `${locator}|${origin.code}|${destination.code}|${dt.depDate}|${flightNumber}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    candidates.push({
      airline: airlineGuess,
      flightNumber,
      origin: origin.city,
      originCode: origin.code,
      destination: destination.city,
      destinationCode: destination.code,
      departureDate: dt.depDate,
      departureTime: dt.depTime,
      arrivalDate: dt.arrDate,
      arrivalTime: dt.arrTime,
      locator,
      passengerName: mainPassengerName || "",
      type,
      stops: /Voo direto/i.test(blockText) ? 0 : 0,
      id: `${locator || "NOLOC"}:${flightNumber || "NOVOO"}:${candidates.length}`,
    });
  }
  // Último fallback: janela por ocorrências de IATA + data
  if (candidates.length === 0) {
    const joined = lines.join("\n");
    const rxIata = /\([A-Z]{3}\)/g;
    const idxs: number[] = [];
    let mi: RegExpExecArray | null;
    while ((mi = rxIata.exec(joined)) !== null) idxs.push(mi.index);
    for (let k = 0; k < idxs.length; k++) {
      const a = idxs[k];
      const window = joined.slice(Math.max(0, a - 600), Math.min(joined.length, a + 1200));
      const { origin, destination } = pickCityPairs(window);
      if (!origin || !destination) continue;
      const dt = pickDateTimes(window);
      if (!dt.depDate) continue;
      const locator = pickLocator(window);
      const code = window.match(directRegex)?.[1] || window.match(flightCodeRegex)?.[1] || "";
      const flightNumber = code ? normalizeFlightCode(code).replace(/^[A-Z]{2,3}/, "") : (window.match(flightNumberOnlyRegex)?.[1] || "");
      const airlineGuess = (inferAirline(window) as any) || lastAirline || "";
      if (airlineGuess) lastAirline = airlineGuess;
      const key = `${locator}|${origin.code}|${destination.code}|${dt.depDate}|${flightNumber}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      candidates.push({
        airline: airlineGuess,
        flightNumber,
        origin: origin.city,
        originCode: origin.code,
        destination: destination.city,
        destinationCode: destination.code,
        departureDate: dt.depDate,
        departureTime: dt.depTime,
        arrivalDate: dt.arrDate,
        arrivalTime: dt.arrTime,
        locator,
        passengerName: mainPassengerName || "",
        type: candidates.length === 0 ? "outbound" : "return",
        stops: /Voo direto/i.test(window) ? 0 : 0,
        id: `${locator || "NOLOC"}:${flightNumber || "NOVOO"}:${candidates.length}`,
      });
    }
  }
  return candidates;
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
  // Remove trailing tags like "(BR4BET)"
  n = n.replace(/\s*\(([A-Z0-9]{2,12})\)\s*$/i, "").trim();
  // Remove leading passenger-type labels that sometimes get concatenated to the name
  n = n.replace(/^(adultos?|adulto|crianças?|criancas?|criança|crianca|bebês?|bebes?|bebê|bebe|infantes?|infante)\s*[:\-]?\s+/i, "");
  // Remove leading email or domain fragments that may leak from parsing
  n = n.replace(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s+/i, "");
  n = n.replace(/^[a-z0-9.-]+\.(?:com|com\.br|net|org|br|io|gov)\s+/i, "");
  // Remove any embedded email token (keep email in its own field)
  n = n.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "");
  n = cleanSpacesLoose(n);
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
type PassengerDomMeta = {
  candidates: number;
  matchedCpf: number;
  extracted: number;
  methodCounts: {
    pFs6: number;
    pAll: number;
    iconPerson: number;
    spanFw: number;
  };
  notes: string[];
};
type PassengerDomResult = { passengers: Passenger[]; meta: PassengerDomMeta };
function extractPassengersFromDomWithMeta(doc: any): PassengerDomResult {
  const meta: PassengerDomMeta = {
    candidates: 0,
    matchedCpf: 0,
    extracted: 0,
    methodCounts: { pFs6: 0, pAll: 0, iconPerson: 0, spanFw: 0 },
    notes: [],
  };
  try {
    if (!doc?.querySelectorAll) {
      meta.notes.push("dom_missing");
      return { passengers: [], meta };
    }
    const pFs6 = Array.from(doc.querySelectorAll("p.fs-6") || []);
    const pAll = Array.from(doc.querySelectorAll("p") || []);
    const iconPerson = Array.from(doc.querySelectorAll("i.bi-person") || []);
    const spanFw = Array.from(doc.querySelectorAll("span.fw-semibold") || []);
    meta.methodCounts = {
      pFs6: pFs6.length,
      pAll: pAll.length,
      iconPerson: iconPerson.length,
      spanFw: spanFw.length,
    };
    const seen = new Set<any>();
    const candidates: any[] = [];
    const push = (el: any) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      candidates.push(el);
    };
    // 1) Most common layout: passenger lines are <p class="fs-6">...</p>
    for (const el of pFs6) push(el);
    // 2) Generic fallback: any <p> that contains CPF
    for (const el of pAll) {
      const txt = (el?.textContent || "").toString();
      if (/\bCPF\b/i.test(txt)) push(el);
    }
    // 3) Icon anchor: <i class="bi bi-person">, walk up to find a parent <p> or <li>
    const closestTag = (node: any, tags: string[]) => {
      let cur = node;
      const set = new Set(tags.map((t) => t.toLowerCase()));
      while (cur && cur.parentElement) {
        const tag = (cur.tagName || "").toString().toLowerCase();
        if (set.has(tag)) return cur;
        cur = cur.parentElement;
      }
      return null;
    };
    for (const icon of iconPerson) {
      const holder = closestTag(icon, ["p", "li", "div"]);
      if (holder) push(holder);
    }
    // 4) Span anchor: <span class="fw-semibold">NAME</span> and parent contains CPF
    for (const sp of spanFw) {
      const holder = closestTag(sp, ["p", "li", "div"]);
      const txt = (holder?.textContent || "").toString();
      if (holder && /\bCPF\b/i.test(txt)) push(holder);
    }
    meta.candidates = candidates.length;
    const byKey = new Map<string, Passenger>();
    const normalizeSpaces = (s: string) => (s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const extractFromTextLine = (txt: string) => {
      const cleaned = normalizeSpaces(txt);
      const cpfMatch = cleaned.match(/\bCPF\s*([0-9.\-]{11,})/i);
      const birthMatch = cleaned.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
      const phoneMatch = cleaned.match(/(\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4})/);
      const emailMatch = cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const cpf = normalizeCPF(cpfMatch?.[1] || "");
      const birthDate = birthMatch?.[1] ? (toISODateFromBR(birthMatch[1]) || "") : "";
      return {
        cpf: cpf && cpf.length === 11 ? cpf : "",
        birthDate,
        phone: phoneMatch?.[1] ? normalizeSpaces(phoneMatch[1]) : "",
        email: emailMatch?.[0] ? emailMatch[0].trim() : "",
      };
    };
    const makeKey = (p: Passenger) => {
      const cpfDigits = normalizeCPF(p.cpf);
      if (cpfDigits.length === 11) return `cpf:${cpfDigits}`;
      const name = sanitizePassengerName(p.fullName || "");
      const birth = (p.birthDate || "").trim();
      if (name && birth) return `namebirth:${name.toUpperCase()}|${birth}`;
      if (name) return `name:${name.toUpperCase()}`;
      return "";
    };
    for (const el of candidates) {
      const txtRaw = (el?.textContent || "").toString();
      const txt = normalizeSpaces(txtRaw);
      // Avoid mixing with other sections: require CPF or (strong name + birth date)
      const hasCpfWord = /\bCPF\b/i.test(txt);
      const hasBirth = /\b\d{2}\/\d{2}\/\d{4}\b/.test(txt);
      let fullName = "";
      const nameEl =
        el?.querySelector?.("span.fw-semibold") ||
        el?.querySelector?.("strong") ||
        null;
      fullName = normalizeSpaces(nameEl?.textContent || "");
      if (!fullName) {
        // Fallback: first chunk before comma often contains the name
        const first = normalizeSpaces(txt.split(",")[0] || "");
        if (isProbablyPersonName(first) && !looksLikeCompanyName(first) && !isLabelName(first)) {
          fullName = first;
        }
      }
      if (!fullName) continue;
      if (!isProbablyPersonName(fullName) || looksLikeCompanyName(fullName) || isLabelName(fullName)) continue;
      // If it does not contain CPF and does not look like a passenger line, skip
      if (!hasCpfWord && !hasBirth) continue;
      const extra = extractFromTextLine(txt);
      if (extra.cpf) meta.matchedCpf += 1;
      const passenger: Passenger = {
        fullName,
        birthDate: extra.birthDate,
        cpf: extra.cpf,
        phone: extra.phone,
        email: extra.email,
        passport: "",
        passportExpiry: "",
      };
      const key = makeKey(passenger);
      if (!key) continue;
      if (byKey.has(key)) continue;
      byKey.set(key, passenger);
    }
    const out = Array.from(byKey.values());
    meta.extracted = out.length;
    if (out.length === 0) {
      meta.notes.push("no_passengers_from_dom");
    }
    return { passengers: out, meta };
  } catch (_) {
    meta.notes.push("dom_exception");
    return { passengers: [], meta };
  }
}
// Backwards compatible wrapper
function extractPassengersFromDom(doc: any): Passenger[] {
  return extractPassengersFromDomWithMeta(doc).passengers;
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
  // Fallback: alguns vouchers do Iddas mostram o aluguel de carro dentro da
  // seção "Transporte" e só exibem a descrição do veículo (sem "Locadora",
  // "Retirada" ou "Devolução").
  // Exemplo:
  //   Transporte
  //   (BX) VW Polo, Hyundai HB20 1.0 ou similar
  if (cars.length === 0) {
    const lines = pageText
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.toLowerCase();
      if (!line) continue;
      const isTransportHeader = line === "transporte" || line.startsWith("transporte ");
      if (!isTransportHeader) continue;
      const next = lines[i + 1] ?? "";
      if (!next) continue;
      const nextLower = next.toLowerCase();
      // Evita pegar cabeçalhos de outras seções.
      if (
        nextLower.startsWith("servi") ||
        nextLower.startsWith("hosped") ||
        nextLower.startsWith("voo") ||
        nextLower.startsWith("passage")
      ) {
        continue;
      }
      cars.push({
        company: undefined,
        category: next,
      });
      break;
    }
  }
  return cars;
}
function matchCarsFromDom(doc: Document): any[] {
  const cars: any[] = [];
  const titles = Array.from(
    doc.querySelectorAll('h6.card-title, h5.card-title, h4.card-title')
  ) as Element[];
  for (const title of titles) {
    const label = (title.textContent || '').trim().toLowerCase();
    if (label !== 'transporte') continue;
    // Estrutura típica: col (header) -> row -> col (container) -> mb-3 (conteúdo)
    const innerCol = title.closest('div.col') as Element | null;
    const headerRow = innerCol?.parentElement as Element | null;
    const outerCol = headerRow?.parentElement as Element | null;
    const scope = outerCol || headerRow || innerCol || (title.parentElement as Element | null);
    if (!scope) continue;
    const descEl = (scope.querySelector('h6.hDescricao') ||
      scope.querySelector('.hDescricao')) as Element | null;
    const rawDesc = (descEl?.textContent || '').trim();
    if (!rawDesc) continue;
    // Tenta pegar algum identificador (às vezes aparece como badge)
    const badge = scope.querySelector('span.badge') as Element | null;
    const locator = (badge?.textContent || '').trim() || null;
    cars.push({
      company: null,
      locator,
      category: rawDesc,
      carModel: rawDesc,
      pickup: null,
      dropoff: null,
      pickupDate: null,
      returnDate: null,
      pickupLocation: null,
      returnLocation: null,
      price: null,
      driver: null,
    });
  }
  return cars;
}
function dedupeCars(list: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const c of list || []) {
    const model = c?.carModel || c?.category || '';
    const loc = c?.locator || '';
    const pDate = c?.pickupDate || c?.pickup?.date || '';
    const rDate = c?.returnDate || c?.dropoff?.date || '';
    const key = [loc, model, pDate, rDate].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
function normalizeCarsWithHotelDates(cars: any[], hotelsOut: any[]): any[] {
  const h0 = (hotelsOut && hotelsOut.length ? hotelsOut[0] : null) as any;
  return (cars || []).map((c) => {
    const pickupDate = c?.pickupDate || c?.pickup?.date || null;
    const returnDate = c?.returnDate || c?.dropoff?.date || null;
    const patchedPickup = pickupDate || h0?.checkIn || null;
    const patchedReturn = returnDate || h0?.checkOut || null;
    return {
      ...c,
      company: c?.company || 'Locadora',
      // Para o painel, basta identificar que existe um aluguel nas datas.
      // Mantemos a descrição em "category" (se existir), mas não exibimos como modelo.
      carModel: null,
      pickupDate: patchedPickup,
      returnDate: patchedReturn,
    };
  });
}
serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const auth = await requireAuthenticatedUser(req, corsHeaders);
    if ("response" in auth) return auth.response;

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
let lastHtml = "";
let lastNormalizedFromHtml = "";
let lastExpectedPassengerCount: number | null = null;
let lastPassengersDomMeta: PassengerDomMeta | null = null;
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
  lastHtml = html;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const rawText = extractTextWithNewlines(parsed) || parsed?.body?.textContent || "";
  const normalized = normalizeText(rawText);
  // Alternate text extraction directly from raw HTML. Some layouts hide or collapse
  // parts of the passenger block when relying only on textContent.
  const normalizedFromHtml = htmlToText(html);
  lastNormalizedFromHtml = normalizedFromHtml;
  const passengersA = extractPassengers(normalized);
  const passengersB = normalizedFromHtml ? extractPassengers(normalizedFromHtml) : [];
  const expectedCount = getExpectedPassengerCount(normalized) ?? getExpectedPassengerCount(normalizedFromHtml);
  lastExpectedPassengerCount = expectedCount;
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
  // DOM-based extraction for IDDAS passenger banner (more reliable for names and reduces cross-matching)
  const domResult = extractPassengersFromDomWithMeta(parsed);
  const passengersDom = domResult.passengers;
  lastPassengersDomMeta = domResult.meta;
  const makePassengerKey = (p: Passenger) => {
    const cpfDigits = normalizeCPF(p.cpf);
    if (cpfDigits.length === 11) return `cpf:${cpfDigits}`;
    const nm = sanitizePassengerName(p.fullName || "");
    const bd = (p.birthDate || "").trim();
    if (nm && bd) return `namebirth:${nm.toUpperCase()}|${bd}`;
    if (nm) return `name:${nm.toUpperCase()}`;
    return "";
  };
  const mergedList: Passenger[] = [];
  const indexByKey = new Map<string, number>();
  const upsertMerged = (p: Passenger, source: "text" | "dom") => {
    const key = makePassengerKey(p);
    if (!key) return;
    const idx = indexByKey.get(key);
    const existing = idx === undefined ? null : mergedList[idx];
    const cpfDigits = normalizeCPF(p.cpf);
    const incomingCpf = cpfDigits.length === 11 ? cpfDigits : "";
    const incomingName = sanitizePassengerName(p.fullName || "");
    const incomingNameIsValid =
      !!incomingName &&
      isProbablyPersonName(incomingName) &&
      !looksLikeCompanyName(incomingName) &&
      !isLabelName(incomingName);
    if (!existing) {
      mergedList.push({
        fullName: incomingNameIsValid ? incomingName : (p.fullName || ""),
        birthDate: p.birthDate || "",
        cpf: incomingCpf || "",
        phone: p.phone || "",
        email: p.email || "",
        passport: p.passport || "",
        passportExpiry: p.passportExpiry || "",
      });
      indexByKey.set(key, mergedList.length - 1);
      return;
    }
    const existingName = sanitizePassengerName(existing.fullName || "");
    const existingWords = existingName ? existingName.split(/\s+/).filter(Boolean).length : 0;
    const incomingWords = incomingName ? incomingName.split(/\s+/).filter(Boolean).length : 0;
    if (incomingNameIsValid) {
      const shouldReplaceName =
        source === "dom"
          ? (incomingWords >= 2 && incomingName !== existingName)
          : (!existingName || !isProbablyPersonName(existingName) || incomingWords > existingWords);
      if (shouldReplaceName) existing.fullName = incomingName;
    }
    if (!existing.birthDate && p.birthDate) existing.birthDate = p.birthDate;
    if (!existing.cpf && incomingCpf) existing.cpf = incomingCpf;
    if (!existing.phone && p.phone) existing.phone = p.phone;
    if (!existing.email && p.email) existing.email = p.email;
    if (!existing.passport && p.passport) existing.passport = p.passport;
    if (!existing.passportExpiry && p.passportExpiry) existing.passportExpiry = p.passportExpiry;
  };
  // Prefer DOM order first, then fill gaps from text extraction
  for (const p of passengersDom) upsertMerged(p, "dom");
  for (const p of extractedPassengers) upsertMerged(p, "text");
  if (mergedList.length) extractedPassengers = mergedList;
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
    
    // Camada primária: extração por DOM (layout novo IDDAS com cards visuais)
    const debugFlights = new URL(req.url).searchParams.get('debug') === '1';
    let flights = extractFlightsFromDom(doc, mainPassengerName, debugFlights);
    // Fallback: se não extraiu nada pelo DOM, usa parser de texto (layouts antigos)
    if (flights.length === 0) {
      const flightSectionText = extractFlightSectionText(doc);
      flights = matchAllFlights(flightSectionText || pageText, mainPassengerName);
    }
    // Map airline reservation links (from QR-code anchors) to flights in order.
    // This improves the "Consultar Reserva" button accuracy for LATAM/GOL.
    const airlineLinks = extractAirlineReservationLinks(doc);
    if (airlineLinks.length > 0) {
      for (let i = 0; i < flights.length; i++) {
        const link = airlineLinks[i];
        if (link) (flights[i] as any).reservationUrl = link;
      }
    }
    // hotelsDom existed in some older revisions; keep it as an empty array here
    // to avoid runtime crashes when only the text-based extractor is used.
    const hotelsDom: ExtractedHotel[] = [];
    const hotelsText = matchAllHotels(pageText) || [];
    const hotelsMerged = [...hotelsDom, ...hotelsText];
    const hotelSeen = new Set<string>();
    const hotels: ExtractedHotel[] = [];
    for (const h of hotelsMerged) {
      const key = h.confirmationCode || `${h.name}|${h.checkIn || ''}|${h.checkOut || ''}`;
      if (hotelSeen.has(key)) continue;
      hotelSeen.add(key);
      hotels.push(h);
    }
    const cars = dedupeCars([
    ...(matchAllCars(pageText) || []),
    ...matchCarsFromDom(doc),
  ]);
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
    const carsOut = normalizeCarsWithHotelDates(cars, hotelsOut);
const dataOut = {
      total: total ?? null,
      suggestedTitle,
      mainPassengerName,
      passengers: passengersOut,
      reservedBy,
      flights,
      hotels: hotelsOut,
      cars: carsOut,
      carRentals: carsOut,
    };
    const shouldIncludeDebug =
      passengersOut.length === 0 ||
      passengersOut.some((p) => !isProbablyPersonName(p.name || "")) ||
      (lastExpectedPassengerCount !== null && passengersOut.length < lastExpectedPassengerCount);
    const debugOut = shouldIncludeDebug
      ? {
          lastStatus,
          expectedPassengerCount: lastExpectedPassengerCount,
          domMeta: lastPassengersDomMeta,
          counts: {
            passengersMerged: passengersOut.length,
            htmlLength: lastHtml.length,
            normalizedTextLength: pageText.length,
            normalizedFromHtmlLength: lastNormalizedFromHtml.length,
          },
          htmlContext: maskSensitiveForDebug(
            extractContext(lastHtml, ["Passageiros", "bi-person", "fw-semibold", "Reservado por", "CPF"], 1400),
          ),
          textContext: maskSensitiveForDebug(
            extractContext(pageText, ["Reservado por", "Passageiros", "CPF"], 1400),
          ),
        }
      : undefined;
    return new Response(
      JSON.stringify({
        success: true,
        data: dataOut,
        ...(debugOut ? { debug: debugOut } : {}),
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
