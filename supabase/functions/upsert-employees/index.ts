// Supabase Edge Function: upsert-employees
// Creates/updates employees for a company from a list of passengers.
// Auth: requires a valid user JWT and that the caller is an admin (admin_users).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

type Passenger = {
  name?: string;
  cpf?: string;
  birthDate?: string | null;
  phone?: string | null;
  email?: string | null;
  passport?: string | null;
};

const toIsoDate = (raw?: any): string | null => {
  const s = (raw ?? "").toString().trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
};

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ code: 401, message: "Missing Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const PROJECT_URL = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "";
    const ANON_KEY =
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_ANON_PUBLIC_KEY") ||
      Deno.env.get("SUPABASE_ANON") ||
      "";
    const SERVICE_ROLE_KEY =
      Deno.env.get("SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE") ||
      "";

    if (!PROJECT_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ code: 500, message: "Missing env vars (PROJECT_URL/ANON_KEY/SERVICE_ROLE_KEY)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAnon = createClient(PROJECT_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ code: 401, message: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const company_id = body?.company_id as string | undefined;
    const passengers = (body?.passengers as Passenger[] | undefined) ?? [];

    if (!company_id) {
      return new Response(JSON.stringify({ code: 400, message: "Missing company_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(passengers)) {
      return new Response(JSON.stringify({ code: 400, message: "passengers must be an array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Permissão: admin OU membro da empresa informada
    const { data: adminRow } = await supabaseAnon
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!adminRow) {
      const { data: membershipRow } = await supabaseAnon
        .from("company_users")
        .select("company_id")
        .eq("user_id", userData.user.id)
        .eq("company_id", company_id)
        .maybeSingle();

      if (!membershipRow) {
        return new Response(JSON.stringify({ code: 403, message: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

    const rows = passengers
      .map((p) => {
        const name = (p?.name ?? "").toString().trim();
        const cpf = (p?.cpf ?? "").toString().replace(/\D/g, "");
        if (!name || cpf.length !== 11) return null;
        return {
          company_id,
          full_name: name,
          cpf,
          birth_date: toIsoDate(p?.birthDate) ?? null,
          phone: (p?.phone ?? "Não informado").toString(),
          email: p?.email ?? null,
          passport: p?.passport ?? null,
          created_by: userData.user.id,
        };
      })
      .filter(Boolean) as any[];

    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, upserted: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: upsertErr, data: upsertData } = await supabaseAdmin
      .from("employees")
      .upsert(rows, { onConflict: "company_id,cpf" })
      .select("id");

    if (upsertErr) {
      console.error("upsert-employees error", upsertErr);
      return new Response(JSON.stringify({ code: 500, message: upsertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, upserted: upsertData?.length ?? rows.length }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("upsert-employees exception", e);
    return new Response(JSON.stringify({ code: 500, message: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
