import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { imageBase64, mimeType } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ success: false, error: "Imagem é obrigatória" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `Você é um extrator de dados de reservas de voo. Analise a imagem e extraia TODAS as informações de voo encontradas.

Para cada voo encontrado (pode haver voo de ida e volta), extraia:
- locator: código localizador da reserva (ex: DWSRHX)
- purchaseNumber: número da compra se disponível
- airline: companhia aérea (LATAM, GOL, AZUL)
- flightNumber: número do voo (ex: AD4523)
- origin: cidade de origem
- originCode: código IATA do aeroporto de origem (ex: CNF)
- destination: cidade de destino
- destinationCode: código IATA do aeroporto de destino (ex: REC)
- departureDate: data de partida no formato DD/MM/YYYY
- departureTime: horário de partida no formato HH:mm
- arrivalDate: data de chegada no formato DD/MM/YYYY
- arrivalTime: horário de chegada no formato HH:mm
- duration: duração do voo no formato XXhYY
- stops: número de paradas (0 para voo direto)
- passengerName: nome do passageiro
- type: 'outbound' para ida, 'return' para volta

Retorne um JSON com a estrutura:
{
  "flights": [
    {
      "locator": "...",
      "purchaseNumber": "...",
      "airline": "...",
      "flightNumber": "...",
      "origin": "...",
      "originCode": "...",
      "destination": "...",
      "destinationCode": "...",
      "departureDate": "...",
      "departureTime": "...",
      "arrivalDate": "...",
      "arrivalTime": "...",
      "duration": "...",
      "stops": 0,
      "passengerName": "...",
      "type": "outbound"
    }
  ]
}

Se não conseguir extrair algum campo, use string vazia ou 0 para números.
Identifique a companhia aérea pelo logo ou nome (Azul, LATAM, GOL).`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType || "image/png"};base64,${imageBase64}`,
                },
              },
              {
                type: "text",
                text: "Extraia todos os dados de voo desta imagem de confirmação de reserva.",
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_flights",
              description: "Extrai dados de voos de uma imagem de reserva",
              parameters: {
                type: "object",
                properties: {
                  flights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        locator: { type: "string" },
                        purchaseNumber: { type: "string" },
                        airline: { type: "string", enum: ["LATAM", "GOL", "AZUL"] },
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
                      required: ["locator", "airline", "passengerName"],
                    },
                  },
                },
                required: ["flights"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_flights" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Limite de requisições atingido. Tente novamente em alguns segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "Créditos insuficientes. Por favor, adicione créditos." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Erro ao processar imagem" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    console.log("AI response:", JSON.stringify(data, null, 2));

    // Extract the tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const extractedData = JSON.parse(toolCall.function.arguments);
      return new Response(
        JSON.stringify({ success: true, data: extractedData }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Não foi possível extrair dados da imagem" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Extract flight data error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
