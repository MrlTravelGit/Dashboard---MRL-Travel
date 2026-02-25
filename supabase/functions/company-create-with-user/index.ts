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
    Deno.serve(async (req) => {
      if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
      }

      try {
        // Variáveis de ambiente com fallback
        const PROJECT_URL = Deno.env.get("PROJECT_URL");
        const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");
        const SUPABASE_ANON_KEY =
          Deno.env.get("SUPABASE_ANON_KEY") ||
          Deno.env.get("VITE_SUPABASE_ANON_KEY") ||
          Deno.env.get("SUPABASE_PUBLIC_ANON_KEY");

        if (!PROJECT_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
          return new Response(
            JSON.stringify({ code: 500, message: "Missing env vars" }),
            { status: 500, headers: corsHeaders }
          );
        }

        // 1) Authorization header robusto
        const authHeader =
          req.headers.get("Authorization") ||
          req.headers.get("authorization") ||
          "";
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return new Response(
            JSON.stringify({ code: 401, message: "Missing Authorization" }),
            { status: 401, headers: corsHeaders }
          );
        }

        // 2) Validar JWT
        const supabaseAnon = createClient(PROJECT_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: userData, error: userError } = await supabaseAnon.auth.getUser();
        if (userError || !userData?.user?.id) {
          return new Response(
            JSON.stringify({ code: 401, message: "Invalid JWT" }),
            { status: 401, headers: corsHeaders }
          );
        }
        const userId = userData.user.id;

        // 3) Checar admin global
        const { data: adminRow } = await supabaseAnon
          .from("admin_users")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();
        if (!adminRow) {
          return new Response(
            JSON.stringify({ code: 403, message: "Not admin" }),
            { status: 403, headers: corsHeaders }
          );
        }

        // 4) Validar payload
        const body = await req.json();
        const { name, cnpj, email, password, payment_deadline_days } = body || {};
        if (!name) return new Response(JSON.stringify({ code: 400, message: "Missing name" }), { status: 400, headers: corsHeaders });
        if (!cnpj) return new Response(JSON.stringify({ code: 400, message: "Missing cnpj" }), { status: 400, headers: corsHeaders });
        if (!email) return new Response(JSON.stringify({ code: 400, message: "Missing email" }), { status: 400, headers: corsHeaders });
        if (typeof payment_deadline_days !== "number") return new Response(JSON.stringify({ code: 400, message: "Missing payment_deadline_days" }), { status: 400, headers: corsHeaders });

        // 5) Criação com service role
        const adminClient = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

        // Inserir empresa
        const { data: company, error: companyErr } = await adminClient
          .from("companies")
          .insert({
            name,
            cnpj,
            email,
            payment_deadline_days,
            created_by: userId,
          })
          .select("id, name")
          .single();
        if (companyErr || !company?.id) {
          console.error("Company creation error:", companyErr);
          return new Response(
            JSON.stringify({ code: 500, message: "Failed to create company", context: companyErr?.message }),
            { status: 500, headers: corsHeaders }
          );
        }

        // Criar usuário no Auth
        let createdUser;
        try {
          createdUser = await adminClient.auth.admin.createUser({
            email,
            password: password || undefined,
            email_confirm: true,
          });
        } catch (e) {
          console.error("User creation error:", e);
          return new Response(
            JSON.stringify({ code: 500, message: "Failed to create user", context: e?.message }),
            { status: 500, headers: corsHeaders }
          );
        }
        const userIdCreated = createdUser?.user?.id;
        if (!userIdCreated) {
          return new Response(
            JSON.stringify({ code: 500, message: "User creation failed" }),
            { status: 500, headers: corsHeaders }
          );
        }

        // Vincular usuário à empresa
        const { error: linkErr } = await adminClient
          .from("company_users")
          .insert({
            company_id: company.id,
            user_id: userIdCreated,
            role: "user",
          });
        if (linkErr) {
          console.error("Link user error:", linkErr);
          return new Response(
            JSON.stringify({ code: 500, message: "Failed to link user to company", context: linkErr?.message }),
            { status: 500, headers: corsHeaders }
          );
        }

        // 6) Sucesso
        return new Response(
          JSON.stringify({
            success: true,
            company: { id: company.id, name: company.name },
            user: { id: userIdCreated, email },
          }),
          { status: 200, headers: corsHeaders }
        );
      } catch (e) {
        console.error("Unexpected error:", e);
        return new Response(
          JSON.stringify({ code: 500, message: "Unexpected error", context: e?.message }),
          { status: 500, headers: corsHeaders }
        );
      }
    });
    );
  }
});
