import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  name: string;
  cnpj: string;
  email: string;
  payment_deadline_days?: number;
  password?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function findUserIdByEmail(supabaseAdmin: any, email: string): Promise<string | null> {
  // Supabase não tem "getUserByEmail" direto. Faz paginação simples.
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 200;

  for (let i = 0; i < 10; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u: any) => (u.email || "").toLowerCase() === target);
    if (found) return found.id;
    if (!data.users.length || data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    // Apenas admin pode criar empresa e usuário.
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
    const name = (body.name || "").trim();
    const cnpj = (body.cnpj || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const paymentDeadlineDays = Number(body.payment_deadline_days ?? 30);
    const password = body.password ? String(body.password).trim() : "";

    if (!name || !cnpj || !email) {
      return new Response(
        JSON.stringify({ success: false, error: "name, cnpj and email are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1) Cria a empresa
    const { data: company, error: companyErr } = await supabaseAdmin
      .from("companies")
      .insert({
        name,
        cnpj,
        email,
        payment_deadline_days: Number.isFinite(paymentDeadlineDays) ? paymentDeadlineDays : 30,
      })
      .select("id,name,cnpj,email,payment_deadline_days,logo_url")
      .single();

    if (companyErr) throw companyErr;

    // 2) Cria ou localiza usuário no Auth
    let userId: string | null = null;
    let created = false;
    let invited = false;

    // tenta encontrar existente
    userId = await findUserIdByEmail(supabaseAdmin, email);

    if (!userId) {
      if (password && password.length >= 6) {
        const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: name },
        });
        if (createErr) throw createErr;
        userId = createdUser.user?.id ?? null;
        created = true;
      } else {
        // convite por e-mail para definir senha
        const { data: invitedUser, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: name },
        });
        if (inviteErr) throw inviteErr;
        userId = invitedUser.user?.id ?? null;
        invited = true;
      }
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Could not create or locate auth user" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3) Vincula usuário à empresa
    const { error: linkErr } = await supabaseAdmin.from("company_users").insert({
      company_id: company.id,
      user_id: userId,
    });

    // Se já existir, ignora.
    if (linkErr && String(linkErr.message || "").toLowerCase().includes("duplicate")) {
      // ignore
    } else if (linkErr) {
      throw linkErr;
    }

    return new Response(
      JSON.stringify({
        success: true,
        company,
        auth: { user_id: userId, created, invited },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
