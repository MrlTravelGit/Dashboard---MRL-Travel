import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: "URL é obrigatória" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url)) {
      return new Response(
        JSON.stringify({ success: false, error: "URL inválida" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      console.error("FIRECRAWL_API_KEY not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl não está configurado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Scraping URL for complete booking:", url);

    // Use Firecrawl to scrape the page
    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: url,
        formats: ["markdown", "html"],
        onlyMainContent: true,
        waitFor: 5000,
      }),
    });

    const scrapeData = await scrapeResponse.json();

    if (!scrapeResponse.ok) {
      console.error("Firecrawl API error:", scrapeData);
      return new Response(
        JSON.stringify({ success: false, error: scrapeData.error || "Erro ao acessar a página" }),
        { status: scrapeResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pageContent = scrapeData.data?.markdown || scrapeData.markdown || "";
    const pageHtml = scrapeData.data?.html || scrapeData.html || "";

    if (!pageContent && !pageHtml) {
      return new Response(
        JSON.stringify({ success: false, error: "Não foi possível extrair conteúdo da página" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Page content extracted, length:", pageContent.length);

    // Use AI to extract ALL booking data (flights, hotels, cars, transfers) AND passenger data
    const systemPrompt = `Você é um extrator de dados de reservas de agências de viagem. Analise o conteúdo da página e extraia TODOS os produtos encontrados: voos, hotéis, aluguéis de carro e transfers.

IMPORTANTE: Também extraia os DADOS DOS PASSAGEIROS/FUNCIONÁRIOS. Eles geralmente aparecem no formato:
NOME COMPLETO, DATA DE NASCIMENTO, CPF, passaporte XX11111, TELEFONE, E-MAIL

Para PASSAGEIROS, extraia OBRIGATORIAMENTE:
- fullName: nome completo do passageiro (OBRIGATÓRIO - sempre extrair)
- birthDate: data de nascimento no formato YYYY-MM-DD (OBRIGATÓRIO - sempre extrair)
- cpf: CPF apenas números, 11 dígitos (OBRIGATÓRIO - sempre extrair)

Os seguintes campos são OPCIONAIS (extraia se disponível, senão deixe vazio ""):
- passport: número do passaporte (ex: XX11111)
- phone: telefone com DDD
- email: e-mail do passageiro

REGRA CRÍTICA PARA PASSAGEIROS:
- SEMPRE inclua TODOS os passageiros que tenham pelo menos NOME, CPF e DATA DE NASCIMENTO.
- NÃO descarte passageiros por falta de telefone, email ou passaporte.
- Se telefone, email ou passaporte não estiverem disponíveis, use string vazia "".

Para VOOS, extraia:
- locator: código localizador da reserva
- purchaseNumber: número da compra se disponível
- airline: companhia aérea (LATAM, GOL, AZUL)
- flightNumber: número do voo
- origin: cidade de origem
- originCode: código IATA do aeroporto de origem
- destination: cidade de destino
- destinationCode: código IATA do aeroporto de destino
- departureDate: data de partida (DD/MM/YYYY)
- departureTime: horário de partida (HH:mm)
- arrivalDate: data de chegada (DD/MM/YYYY)
- arrivalTime: horário de chegada (HH:mm)
- duration: duração do voo
- stops: número de paradas
- passengerName: nome do passageiro
- type: 'outbound' para ida, 'return' para volta

Para HOTÉIS, extraia:
- locator: código da reserva do hotel
- hotelName: nome do hotel
- checkIn: data de entrada (DD/MM/YYYY)
- checkOut: data de saída (DD/MM/YYYY)
- nights: número de noites
- rooms: número de quartos
- breakfast: true se inclui café da manhã
- guestName: nome do hóspede

Para ALUGUÉIS DE CARRO, extraia:
- locator: código da reserva
- company: empresa locadora
- carModel: modelo do carro
- pickupLocation: local de retirada
- pickupDate: data de retirada (DD/MM/YYYY)
- pickupTime: horário de retirada (HH:mm)
- returnLocation: local de devolução
- returnDate: data de devolução (DD/MM/YYYY)
- returnTime: horário de devolução (HH:mm)
- driverName: nome do motorista

Para TRANSFERS, extraia:
- locator: código da reserva
- type: tipo (aeroporto, hotel, etc)
- origin: origem
- destination: destino
- date: data (DD/MM/YYYY)
- time: horário (HH:mm)
- passengerName: nome do passageiro
- vehicleType: tipo de veículo

Também extraia um título sugerido para a reserva baseado no destino/período.
Se não conseguir extrair algum campo, use string vazia ou 0 para números.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Extraia todos os dados de reserva (voos, hotéis, carros, transfers) desta página:\n\n${pageContent}\n\nHTML:\n${pageHtml.substring(0, 15000)}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_booking",
              description: "Extrai todos os dados de uma reserva completa incluindo passageiros",
              parameters: {
                type: "object",
                properties: {
                  suggestedTitle: { type: "string", description: "Título sugerido para a reserva" },
                  mainPassengerName: { type: "string", description: "Nome do passageiro principal" },
                  passengers: {
                    type: "array",
                    description: "Lista de passageiros/funcionários encontrados na reserva",
                    items: {
                      type: "object",
                      properties: {
                        fullName: { type: "string", description: "Nome completo do passageiro" },
                        birthDate: { type: "string", description: "Data de nascimento (YYYY-MM-DD)" },
                        cpf: { type: "string", description: "CPF apenas números" },
                        passport: { type: "string", description: "Número do passaporte" },
                        passportExpiry: { type: "string", description: "Validade do passaporte (YYYY-MM-DD)" },
                        phone: { type: "string", description: "Telefone com DDD" },
                        email: { type: "string", description: "E-mail" },
                      },
                      required: ["fullName"],
                    },
                  },
                  flights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        locator: { type: "string" },
                        purchaseNumber: { type: "string" },
                        airline: { type: "string" },
                        flightNumber: { type: "string" },
                        origin: { type: "string" },
                        originCode: { type: "string" },
                        destination: { type: "string" },
                        destinationCode: { type: "string" },
                        departureDate: { type: "string" },
                        departureTime: { type: "string" },
                        arrivalDate: { type: "string" },
                        arrivalTime: { type: "string" },
                        duration: { type: "string" },
                        stops: { type: "number" },
                        passengerName: { type: "string" },
                        type: { type: "string", enum: ["outbound", "return", "internal"] },
                      },
                    },
                  },
                  hotels: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        locator: { type: "string" },
                        hotelName: { type: "string" },
                        checkIn: { type: "string" },
                        checkOut: { type: "string" },
                        nights: { type: "number" },
                        rooms: { type: "number" },
                        breakfast: { type: "boolean" },
                        guestName: { type: "string" },
                      },
                    },
                  },
                  carRentals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        locator: { type: "string" },
                        company: { type: "string" },
                        carModel: { type: "string" },
                        pickupLocation: { type: "string" },
                        pickupDate: { type: "string" },
                        pickupTime: { type: "string" },
                        returnLocation: { type: "string" },
                        returnDate: { type: "string" },
                        returnTime: { type: "string" },
                        driverName: { type: "string" },
                      },
                    },
                  },
                  transfers: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        locator: { type: "string" },
                        type: { type: "string" },
                        origin: { type: "string" },
                        destination: { type: "string" },
                        date: { type: "string" },
                        time: { type: "string" },
                        passengerName: { type: "string" },
                        vehicleType: { type: "string" },
                      },
                    },
                  },
                },
                required: ["flights", "hotels", "carRentals", "transfers", "passengers"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_booking" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Limite de requisições atingido. Tente novamente em alguns segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "Créditos insuficientes. Por favor, adicione créditos." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Erro ao processar dados da página" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    console.log("AI response:", JSON.stringify(aiData, null, 2));

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const extractedData = JSON.parse(toolCall.function.arguments);
      return new Response(
        JSON.stringify({ success: true, data: extractedData }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Não foi possível extrair dados da página" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Extract booking from link error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
