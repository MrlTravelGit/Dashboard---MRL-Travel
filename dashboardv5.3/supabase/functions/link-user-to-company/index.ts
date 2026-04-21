import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

type Body = {
  email?: string;
  user_id?: string;
  company_id: string;
  role?: "admin" | "user";
};

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const PROJECT_URL = Deno.env.get("PROJECT_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");

    if (!PROJECT_URL || !SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing PROJECT_URL or SERVICE_ROLE_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Confirma quem está chamando (tem que ser admin)
    const token = authHeader.replace("Bearer ", "");
    const { data: caller, error: callerErr } = await supabaseAdmin.auth.getUser(token);

    if (callerErr || !caller?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerId = caller.user.id;

    // Verifica se caller é admin no seu modelo (ajuste conforme seu banco)
    // Exemplo 1: tabela admin_users com user_id
    const { data: isAdminRow } = await supabaseAdmin
      .from("admin_users")
      .select("id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (!isAdminRow) {
      return new Response(
        JSON.stringify({ success: false, error: "Not allowed" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json()) as Body;

    if (!body.company_id) {
      return new Response(
        JSON.stringify({ success: false, error: "company_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let targetUserId = body.user_id?.trim();

    if (!targetUserId) {
      const email = body.email?.trim().toLowerCase();
      if (!email) {
        return new Response(
          JSON.stringify({ success: false, error: "email or user_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
        perPage: 200,
      });

      if (listErr) throw listErr;

      const u = users.users.find((x) => (x.email || "").toLowerCase() === email);
      if (!u) {
        return new Response(
          JSON.stringify({ success: false, error: "User not found for this email" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      targetUserId = u.id;
    }

    const role = body.role || "user";

    // UPSERT para não duplicar
    const { error: upErr } = await supabaseAdmin
      .from("company_users")
      .upsert(
        {
          user_id: targetUserId,
          company_id: body.company_id,
          role,
        },
        { onConflict: "user_id,company_id" }
      );

    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({ success: true, user_id: targetUserId, company_id: body.company_id, role }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
