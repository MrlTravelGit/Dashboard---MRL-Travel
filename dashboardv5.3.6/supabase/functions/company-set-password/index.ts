import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

type Body = {
  company_id: string;
  new_password: string;
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

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

    const token = authHeader.replace("Bearer ", "");
    const { data: caller, error: callerErr } = await supabaseAdmin.auth.getUser(token);

    if (callerErr || !caller?.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerId = caller.user.id;

    // Confirma admin via tabela admin_users
    const { data: isAdminRow } = await supabaseAdmin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", callerId)
      .maybeSingle();

    if (!isAdminRow) {
      return new Response(
        JSON.stringify({ success: false, error: "Not allowed" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json()) as Body;

    if (!body.company_id || !body.new_password) {
      return new Response(
        JSON.stringify({ success: false, error: "company_id and new_password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newPassword = body.new_password.trim();
    if (newPassword.length < 6) {
      return new Response(
        JSON.stringify({ success: false, error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Busca email da empresa
    const { data: company, error: companyErr } = await supabaseAdmin
      .from("companies")
      .select("id,email")
      .eq("id", body.company_id)
      .maybeSingle();

    if (companyErr) throw companyErr;
    if (!company?.email) {
      return new Response(
        JSON.stringify({ success: false, error: "Company not found or missing email" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const companyEmail = String(company.email).toLowerCase();

    // Localiza o usuário no Auth pelo email
    const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (listErr) throw listErr;

    const target = users.users.find((u) => (u.email || "").toLowerCase() === companyEmail);
    if (!target) {
      return new Response(
        JSON.stringify({ success: false, error: "Auth user not found for company email" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(target.id, {
      password: newPassword,
    });

    if (updErr) throw updErr;

    return new Response(
      JSON.stringify({ success: true, user_id: target.id, email: companyEmail }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
