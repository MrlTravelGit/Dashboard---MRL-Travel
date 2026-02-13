import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "admin" | "user";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  companyId: string | null;
  appRole: AppRole | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [appRole, setAppRole] = useState<AppRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Guard para evitar reentrância de loadRoleAndCompany
  const loadingRoleRef = useRef<string | null>(null);

  const clearSupabaseStorage = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) keys.push(k);
      }
      for (const k of keys) {
        if (k.startsWith("sb-")) localStorage.removeItem(k);
      }
    } catch {
      // ignore
    }
  };

  const resetAuthState = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    clearSupabaseStorage();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    setCompanyId(null);
    setAppRole(null);
  };

  /**
   * Carrega role (admin/user) e company_id com retry leve.
   * Não bloqueia o app se falhar - apenas registra warning e continua.
   * Evita reentrância com useRef guard.
   */
  const loadRoleAndCompany = async (userId: string) => {
    // Evitar reentrância
    if (loadingRoleRef.current === userId) {
      console.warn(
        `loadRoleAndCompany já em execução para ${userId}, ignorando chamada`
      );
      return;
    }

    loadingRoleRef.current = userId;

    try {
      let attempt = 1;
      const maxAttempts = 2;
      const delays = [500, 1500]; // ms entre tentativas

      while (attempt <= maxAttempts) {
        try {
          const [adminRes, companyRes] = await Promise.all([
            supabase
              .from("admin_users")
              .select("user_id")
              .eq("user_id", userId)
              .maybeSingle(),
            supabase
              .from("company_users")
              .select("company_id")
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

          const adminData = adminRes.data;
          const companyData = companyRes.data;

          const admin = !!adminData;
          setIsAdmin(admin);
          setAppRole(admin ? "admin" : "user");
          setCompanyId(companyData?.company_id ?? null);

          return; // Sucesso
        } catch (e) {
          if (attempt < maxAttempts) {
            const delay = delays[attempt - 1];
            console.warn(
              `loadRoleAndCompany falhou na tentativa ${attempt}/${maxAttempts}, ` +
                `retentando em ${delay}ms:`,
              e
            );
            await new Promise((r) => setTimeout(r, delay));
            attempt++;
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      // Se todas as tentativas falharem, registra warning mas mantém user logado
      console.warn("loadRoleAndCompany falhou após múltiplas tentativas:", e);
      setIsAdmin(false);
      setCompanyId(null);
      setAppRole(null);
      // App continua utilizável, user permanece autenticado
    } finally {
      loadingRoleRef.current = null;
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        // Recupera sessão SEM Promise.race agressivo.
        // Deixamos a promise natural, apenas protegendo com timeout 30s max como fallback.
        let abortTimeoutId: number | undefined;
        let timeoutOccurred = false;

        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          abortTimeoutId = window.setTimeout(() => {
            timeoutOccurred = true;
            reject(new Error("getSession: timeout de proteção 30s"));
          }, 30000);
        });

        let sessionResult;
        try {
          sessionResult = await Promise.race([sessionPromise, timeoutPromise]);
        } catch (e) {
          if (timeoutOccurred) {
            console.warn(
              "Timeout na recuperação de sessão após 30s. " +
                "Permitindo que o app continue, sessão será atualizada quando disponível."
            );
            // Não quebra o estado, apenas registra warning
            sessionResult = { data: { session: null }, error: null };
          } else {
            throw e;
          }
        } finally {
          if (abortTimeoutId !== undefined) {
            window.clearTimeout(abortTimeoutId);
          }
        }

        const { data, error } = sessionResult;

        if (error) {
          console.error("getSession error:", error);
          setUser(null);
          setSession(null);
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole(null);
          return;
        }

        const currentSession = data?.session ?? null;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user?.id) {
          await loadRoleAndCompany(currentSession.user.id);
        } else {
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole(null);
        }
      } catch (e) {
        console.error("Auth init falhou:", e);
        // Mantém app utilizável - timeout/erro de rede não força logout
        setUser(null);
        setSession(null);
        setIsAdmin(false);
        setCompanyId(null);
        setAppRole(null);
      } finally {
        // GARANTIDO: loading sempre completa
        setIsLoading(false);
      }
    };

    void init();

    // Listener de mudanças de autenticação
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        // Reset role/company ao trocar usuário
        if (newSession?.user?.id) {
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole(null);
          // Recarrega role/company para novo usuário
          await loadRoleAndCompany(newSession.user.id);
        } else {
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole(null);
        }

        setIsLoading(false);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    await resetAuthState();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isAdmin,
        companyId,
        appRole,
        isLoading,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
