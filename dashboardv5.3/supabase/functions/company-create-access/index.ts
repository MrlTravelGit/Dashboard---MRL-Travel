import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

type Body = {
  company_id: string;
  email: string;
  password?: string | null;
  role?: string | null;
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

function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
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

    // Validate JWT (anon client with forwarded auth header)
    const supabaseAnon = createClient(PROJECT_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !userData?.user?.id) {
      console.error("Invalid JWT", userError);
      return json(corsHeaders, 401, { code: 401, message: "Invalid JWT" });
    }
    const callerUserId = userData.user.id;

    // Admin check (RLS enforced)
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

    const company_id = (body?.company_id || "").trim();
    const email = normalizeEmail(body?.email || "");
    const password = body?.password && body.password.trim() ? body.password.trim() : null;
    const role = (body?.role || "user").trim() || "user";

    if (!company_id) return json(corsHeaders, 400, { code: 400, message: "Missing company_id" });
    if (!email) return json(corsHeaders, 400, { code: 400, message: "Missing email" });

    const adminClient = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

    // Ensure company exists
    const { data: companyRow, error: companyErr } = await adminClient
      .from("companies")
      .select("id, email")
      .eq("id", company_id)
      .maybeSingle();

    if (companyErr) {
      console.error("Company lookup error", companyErr);
      return json(corsHeaders, 500, { code: 500, message: "Failed to lookup company" });
    }
    if (!companyRow?.id) {
      return json(corsHeaders, 404, { code: 404, message: "Company not found" });
    }

    // Create user (or invite)
    let newUserId: string | null = null;

    if (password) {
      const createUserResult = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createUserResult.error || !createUserResult.data?.user?.id) {
        console.error("User creation error", createUserResult.error);
        return json(corsHeaders, 500, {
          code: 500,
          message: "Failed to create user",
          context: createUserResult.error?.message,
        });
      }

      newUserId = createUserResult.data.user.id;
    } else {
      const inviteResult = await adminClient.auth.admin.inviteUserByEmail(email);
      if (inviteResult.error || !inviteResult.data?.user?.id) {
        console.error("Invite error", inviteResult.error);
        return json(corsHeaders, 500, {
          code: 500,
          message: "Failed to invite user",
          context: inviteResult.error?.message,
        });
      }
      newUserId = inviteResult.data.user.id;
    }

    if (!newUserId) {
      return json(corsHeaders, 500, { code: 500, message: "Failed to create user" });
    }

    // Link user to company (avoid ON CONFLICT dependency)
    const { data: existingLink, error: linkLookupErr } = await adminClient
      .from("company_users")
      .select("id, role")
      .eq("company_id", company_id)
      .eq("user_id", newUserId)
      .maybeSingle();

    if (linkLookupErr) {
      console.error("Link lookup error", linkLookupErr);
      return json(corsHeaders, 500, { code: 500, message: "Failed to check existing link" });
    }

    if (!existingLink) {
      const { error: linkErr } = await adminClient.from("company_users").insert({
        company_id,
        user_id: newUserId,
        role,
      });

      if (linkErr) {
        console.error("Link insert error", linkErr);
        return json(corsHeaders, 500, {
          code: 500,
          message: "Failed to link user to company",
          context: linkErr.message,
        });
      }
    } else if (existingLink.role !== role) {
      const { error: linkUpdateErr } = await adminClient
        .from("company_users")
        .update({ role })
        .eq("id", existingLink.id);

      if (linkUpdateErr) {
        console.error("Link update error", linkUpdateErr);
        return json(corsHeaders, 500, {
          code: 500,
          message: "Failed to update user role",
          context: linkUpdateErr.message,
        });
      }
    }

    // Keep companies.email synced with access email (optional)
    if ((companyRow.email || "").toLowerCase() !== email) {
      const { error: companyUpdateErr } = await adminClient
        .from("companies")
        .update({ email })
        .eq("id", company_id);

      if (companyUpdateErr) {
        console.error("Company email update error", companyUpdateErr);
        // Non-fatal
      }
    }

    return json(corsHeaders, 200, {
      success: true,
      company: { id: company_id },
      user: { id: newUserId, email },
      invited: !password,
    });
  } catch (e) {
    console.error("Unexpected error", e);
    return json(corsHeaders, 500, {
      code: 500,
      message: "Unexpected error",
      context: (e as any)?.message,
    });
  }
});
