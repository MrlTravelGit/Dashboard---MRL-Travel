// Shared CORS helpers for Supabase Edge Functions.
// Goal: avoid browser-side CORS blocks (especially preflight) when calling functions from Vercel/custom domains.

export function buildCorsHeaders(req: Request): Record<string, string> {
  const originHeader = req.headers.get("origin");
  const allowedOrigins = new Set(
    (Deno.env.get("ALLOWED_ORIGINS") || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  const vercelUrl = Deno.env.get("VERCEL_URL");
  if (vercelUrl) allowedOrigins.add(`https://${vercelUrl}`);

  allowedOrigins.add("http://localhost:5173");
  allowedOrigins.add("http://127.0.0.1:5173");
  allowedOrigins.add("http://localhost:4173");
  allowedOrigins.add("http://127.0.0.1:4173");

  const isAllowedOrigin = !!originHeader && allowedOrigins.has(originHeader);
  const origin = originHeader || "*";

  // The browser sends this header on preflight, listing what it wants to send.
  // Echoing it back prevents "Request header field X is not allowed" issues.
  const requestedHeaders = req.headers.get("Access-Control-Request-Headers");

  const allowHeaders =
    requestedHeaders ||
    [
      "authorization",
      "x-client-info",
      "apikey",
      "content-type",
      // Supabase JS adds these in some environments
      "x-supabase-client-platform",
      "x-supabase-client-platform-version",
      "x-supabase-client-runtime",
      "x-supabase-client-runtime-version",
      "x-supabase-api-version",
    ].join(", ");

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": isAllowedOrigin ? "true" : "false",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
