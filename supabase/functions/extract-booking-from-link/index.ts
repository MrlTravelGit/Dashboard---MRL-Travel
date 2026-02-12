import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  fetchPageText,
  extractPassengers,
  extractMainPassengerName,
  matchAllFlights,
  extractHotels,
  normalizeText,
} from "../_shared/extractor_shared.ts";

type ExtractResponse = {
  success: boolean;
  error?: string;
  data?: any;
};

function buildSuggestedTitle(flights: any[], hotels: any[]) {
  if (Array.isArray(flights) && flights.length) {
    const f0 = flights[0];
    const o = (f0.originCode || f0.origin || "").toString().trim();
    const d = (f0.destinationCode || f0.destination || "").toString().trim();
    const date = (f0.departureDate || "").toString().trim();
    const route = [o, d].filter(Boolean).join(" → ");
    return [route, date ? `(${date})` : ""].filter(Boolean).join(" ").trim();
  }
  if (Array.isArray(hotels) && hotels.length) {
    const h0 = hotels[0];
    const name = (h0.hotelName || "Hospedagem").toString().trim();
    const ci = (h0.checkIn || "").toString().trim();
    const co = (h0.checkOut || "").toString().trim();
    const dates = [ci, co].filter(Boolean).join(" a ");
    return [name, dates ? `(${dates})` : ""].filter(Boolean).join(" ").trim();
  }
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    const url = (body?.url || "").toString().trim();

    if (!url) {
      const out: ExtractResponse = { success: false, error: "URL é obrigatória" };
      return new Response(JSON.stringify(out), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If this is IDDAS, use the dedicated function.
    if (/agencia\.iddas\.com\.br\/reserva\//i.test(url)) {
      const out: ExtractResponse = {
        success: false,
        error: "Link do IDDAS detectado. Use a função extract-iddas-booking para melhores resultados.",
      };
      return new Response(JSON.stringify(out), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ok, status, text } = await fetchPageText(url);

    if (!ok) {
      const out: ExtractResponse = { success: false, error: `Não foi possível acessar a página (HTTP ${status}).` };
      return new Response(JSON.stringify(out), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pageText = normalizeText(text);

    const passengers = extractPassengers(pageText);
    const mainPassengerName =
      (passengers[0]?.fullName || "").trim() || extractMainPassengerName(pageText);

    const flights = matchAllFlights(pageText, mainPassengerName);
    const hotels = extractHotels(pageText, mainPassengerName);

    const suggestedTitle = buildSuggestedTitle(flights, hotels);

    const out: ExtractResponse = {
      success: true,
      data: {
        flights,
        hotels,
        carRentals: [],
        passengers,
        mainPassengerName,
        suggestedTitle,
      },
    };

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-booking-from-link error:", e);
    const out: ExtractResponse = { success: false, error: "Erro interno na extração do link." };
    return new Response(JSON.stringify(out), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
