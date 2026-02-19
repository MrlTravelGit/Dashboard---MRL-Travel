import { supabase } from "@/integrations/supabase/client";

/**
 * Limpa sessão do Supabase, cookies e tokens locais, e recarrega a página.
 * Nunca lança erro. Pode ser chamado em qualquer contexto.
 */
export async function resetSessionAndReload() {
  try {
    try {
      await supabase.auth.signOut();
    } catch {}

    // Limpa localStorage
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (
          k.startsWith("sb-") ||
          k.includes("supabase") ||
          k.includes("auth-token")
        ) {
          keys.push(k);
        }
      }
      for (const k of keys) localStorage.removeItem(k);
    } catch {}

    // Limpa sessionStorage
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (!k) continue;
        if (
          k.startsWith("sb-") ||
          k.includes("supabase") ||
          k.includes("auth-token")
        ) {
          keys.push(k);
        }
      }
      for (const k of keys) sessionStorage.removeItem(k);
    } catch {}
  } catch {}
  try {
    window.location.reload();
  } catch {}
}
