import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 1. Trata a requisição OPTIONS (Preflight) - ISSO CORRIGE O ERRO DE CONEXÃO
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      throw new Error("URL é obrigatória no corpo da requisição.");
    }

    console.log(`Iniciando extração para: ${url}`);

    // AQUI VAI SUA LÓGICA DE EXTRAÇÃO REAL.
    // Para testar agora, estou retornando uma estrutura que funciona 100% com seu front.
    // Você pode recolocar seus regexes aqui depois que o erro de conexão sumir.
    
    const mockResponse = {
      success: true,
      data: {
        suggestedTitle: "Reserva Importada (Teste)",
        mainPassengerName: "Passageiro Principal",
        passengers: [
          { 
            name: "João Silva", 
            cpf: "000.000.000-00", 
            birthDate: "1990-01-01", 
            email: "joao@email.com",
            phone: "11999999999" 
          }
        ],
        flights: [],
        hotel: {
          name: "Hotel Exemplo",
          checkIn: "2024-12-01",
          checkOut: "2024-12-05",
          locator: "LOC123"
        },
        car: null
      }
    };

    return new Response(JSON.stringify(mockResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error("Erro na Edge Function:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});