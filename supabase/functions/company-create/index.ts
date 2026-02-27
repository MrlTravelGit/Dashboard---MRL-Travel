import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

type Body = {
  name: string;
  cnpj: string;
  email: string;
  payment_deadline_days?: number;
};

function json(corsHeaders: Record<string, string>, status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getEnv(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : undefined;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(corsHeaders, 405, { code: 405, message: "Method not allowed" });
  }

  try {
    const PROJECT_URL =
      getEnv("PROJECT_URL") ||
      getEnv("SUPABASE_URL") ||
      getEnv("VITE_SUPABASE_URL");

    const SERVICE_ROLE_KEY =
      getEnv("SERVICE_ROLE_KEY") ||
      getEnv("SUPABASE_SERVICE_ROLE_KEY") ||
      getEnv("SUPABASE_SERVICE_ROLE") ||
      getEnv("SUPABASE_SERVICE_ROLE_SECRET");

    const SUPABASE_ANON_KEY =
      getEnv("SUPABASE_ANON_KEY") ||
      getEnv("SUPABASE_PUBLIC_ANON_KEY") ||
      getEnv("SUPABASE_ANON_PUBLIC_KEY") ||
      getEnv("VITE_SUPABASE_ANON_KEY");

    if (!PROJECT_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      console.error("Missing env vars", {
        PROJECT_URL: !!PROJECT_URL,
        SERVICE_ROLE_KEY: !!SERVICE_ROLE_KEY,
        SUPABASE_ANON_KEY: !!SUPABASE_ANON_KEY,
      });
      return json(corsHeaders, 500, { code: 500, message: "Missing env vars" });
    }

    const authHeader =
      req.headers.get("authorization") ||
      req.headers.get("Authorization") ||
      "";

    if (!authHeader.startsWith("Bearer ")) {
      return json(corsHeaders, 401, { code: 401, message: "Missing Authorization" });
    }

    const supabaseAnon = createClient(PROJECT_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !userData?.user?.id) {
      console.error("Invalid JWT", userError);
      return json(corsHeaders, 401, { code: 401, message: "Invalid JWT" });
    }
    const callerUserId = userData.user.id;

    const { data: adminRow, error: adminErr } = await supabaseAnon
      .from("admin_users")
      .select("user_id")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (adminErr) {
      console.error("Admin check error", adminErr);
      return json(corsHeaders, 500, { code: 500, message: "Admin check failed" });
    }
    if (!adminRow) {
      return json(corsHeaders, 403, { code: 403, message: "Not admin" });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(corsHeaders, 400, { code: 400, message: "Invalid JSON body" });
    }

    const name = (body?.name || "").trim();
    const cnpj = (body?.cnpj || "").trim();
    const email = (body?.email || "").trim().toLowerCase();
    const payment_deadline_days =
      typeof body?.payment_deadline_days === "number" && Number.isFinite(body.payment_deadline_days)
        ? body.payment_deadline_days
        : 30;

    if (!name) return json(corsHeaders, 400, { code: 400, message: "Missing name" });
    if (!cnpj) return json(corsHeaders, 400, { code: 400, message: "Missing cnpj" });
    if (!email) return json(corsHeaders, 400, { code: 400, message: "Missing email" });

    const adminClient = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

    const { data: company, error: companyErr } = await adminClient
      .from("companies")
      .insert({
        name,
        cnpj,
        email,
        payment_deadline_days,
        created_by: callerUserId,
      })
      .select("id, name, cnpj, email, payment_deadline_days, logo_url, created_at, updated_at")
      .single();

    if (companyErr || !company?.id) {
      console.error("Company creation error", companyErr);
      return json(corsHeaders, 500, {
        code: 500,
        message: "Failed to create company",
        context: companyErr?.message,
      });
    }

    return json(corsHeaders, 200, { success: true, company });
  } catch (e) {
    console.error("Unexpected error", e);
    return json(corsHeaders, 500, { code: 500, message: "Unexpected error", context: (e as any)?.message });
  }
});
