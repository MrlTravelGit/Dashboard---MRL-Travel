import { supabase } from "@/integrations/supabase/client";

// Limpa dados de autenticação do Supabase e recarrega a aplicação.
// Útil quando o navegador fica preso em loading após trocar de aba.
export async function resetSessionAndReload() {
  try {
    await supabase.auth.signOut();
  } catch {
    // segue para limpar storage mesmo assim
  }

  const shouldRemove = (k: string) =>
    k.startsWith("sb-") || k.includes("supabase") || k.includes("auth-token");

  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && shouldRemove(k)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }

  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && shouldRemove(k)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }

  window.location.reload();
}
