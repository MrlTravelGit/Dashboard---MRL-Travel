import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AuthResult =
  | { user: { id: string; email?: string | null } }
  | { response: Response };

function json(corsHeaders: Record<string, string>, status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getEnv(...names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  return "";
}

export async function requireAuthenticatedUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { response: json(corsHeaders, 401, { success: false, error: "Missing Authorization" }) };
  }

  const projectUrl = getEnv("PROJECT_URL", "SUPABASE_URL");
  const anonKey = getEnv(
    "SUPABASE_ANON_KEY",
    "SUPABASE_ANON_PUBLIC_KEY",
    "SUPABASE_ANON",
  );

  if (!projectUrl || !anonKey) {
    return { response: json(corsHeaders, 500, { success: false, error: "Missing auth env vars" }) };
  }

  const supabase = createClient(projectUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    return { response: json(corsHeaders, 401, { success: false, error: "Invalid JWT" }) };
  }

  return { user: { id: data.user.id, email: data.user.email } };
}
