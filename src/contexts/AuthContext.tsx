import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "admin" | "user";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  appRole: AppRole | null;
  companyId: string | null;
  isLoading: boolean;
  isLoadingRole: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const isDev = import.meta.env.DEV;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [appRole, setAppRole] = useState<AppRole | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRole, setIsLoadingRole] = useState(false);

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
   * 
   * Utiliza a tabela user_roles para obter a role corretamente.
   */
  const loadRoleAndCompany = async (userId: string) => {
    // Evitar reentrância
    if (loadingRoleRef.current === userId) {
      if (isDev) {
        console.warn(
          `[AUTH] loadRoleAndCompany já em execução para ${userId}, ignorando chamada`
        );
      }
      return;
    }

    loadingRoleRef.current = userId;
    setIsLoadingRole(true);

    try {
      let attempt = 1;
      const maxAttempts = 2;
      const delays = [500, 1500]; // ms entre tentativas

      while (attempt <= maxAttempts) {
        try {
          // Query 1: Buscar role na tabela user_roles
          const roleRes = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .maybeSingle();

          // Query 2: Buscar company_id (primeira empresa associada)
          const companyRes = await supabase
            .from("company_users")
            .select("company_id")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          // Se ambas as queries tiverem erro, trata o erro
          if (roleRes.error && roleRes.error.code !== "PGRST116") {
            // PGRST116 = no rows found (esperado para usuários sem role)
            throw roleRes.error;
          }
          if (companyRes.error && companyRes.error.code !== "PGRST116") {
            throw companyRes.error;
          }

          // Atualizar estado com a role obtida
          const role = roleRes.data?.role ?? "user";
          const cid = companyRes.data?.company_id ?? null;

          setAppRole(role);
          setIsAdmin(role === "admin");
          setCompanyId(cid);

          if (isDev) {
            console.log(
              `[AUTH] role carregada: role=${role}, isAdmin=${role === "admin"}, companyId=${cid}`
            );
          }

          return; // Sucesso
        } catch (e) {
          if (attempt < maxAttempts) {
            const delay = delays[attempt - 1];
            if (isDev) {
              console.warn(
                `[AUTH] loadRoleAndCompany falhou na tentativa ${attempt}/${maxAttempts}, ` +
                  `retentando em ${delay}ms:`,
                e
              );
            }
            await new Promise((r) => setTimeout(r, delay));
            attempt++;
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      // Se todas as tentativas falharem, registra warning mas mantém user logado
      if (isDev) {
        console.warn(
          `[AUTH] loadRoleAndCompany falhou após múltiplas tentativas:`,
          e
        );
      }
      // Define role como "user" por padrão se falhar (fallback seguro)
      setAppRole("user");
      setIsAdmin(false);
      setCompanyId(null);
      // App continua utilizável, user permanece autenticado
    } finally {
      loadingRoleRef.current = null;
      setIsLoadingRole(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      setIsLoadingRole(false);
      try {
        // Recupera sessão SEM Promise.race agressivo.
        // Deixamos a promise natural, apenas protegendo com timeout 30s max como fallback.
        let timeoutId: number | undefined;
        let timeoutOccurred = false;

        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            timeoutOccurred = true;
            reject(new Error("getSession: timeout de proteção 30s"));
          }, 30000);
        });

        let sessionResult: {
          data: { session: Session | null };
          error: any;
        };
        try {
          sessionResult = await Promise.race([sessionPromise, timeoutPromise]);
        } catch (e) {
          if (timeoutOccurred) {
            if (isDev) {
              console.warn(
                "[AUTH] Timeout na recuperação de sessão após 30s. " +
                  "Permitindo que o app continue, sessão será atualizada quando disponível."
              );
            }
            // Não quebra o estado, apenas registra warning
            sessionResult = { data: { session: null }, error: null };
          } else {
            throw e;
          }
        } finally {
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          }
        }

        const { data, error } = sessionResult;

        if (error) {
          if (isDev) {
            console.error("[AUTH] getSession error:", error);
          }
          setUser(null);
          setSession(null);
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole("user");
          return;
        }

        const currentSession = data?.session ?? null;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (isDev) {
          console.log("[AUTH] session user:", currentSession?.user?.id);
        }

        // SEMPRE carrega role/company após obter a sessão
        if (currentSession?.user?.id) {
          await loadRoleAndCompany(currentSession.user.id);
        } else {
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole("user");
        }
      } catch (e) {
        if (isDev) {
          console.error("[AUTH] Auth init falhou:", e);
        }
        // Mantém app utilizável - timeout/erro de rede não força logout
        setUser(null);
        setSession(null);
        setIsAdmin(false);
        setCompanyId(null);
        setAppRole("user");
      } finally {
        // GARANTIDO: loading sempre completa
        setIsLoading(false);
      }
    };

    void init();

    // Listener de mudanças de autenticação
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (isDev) {
          console.log("[AUTH] onAuthStateChange event:", _event);
        }

        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (isDev) {
          console.log("[AUTH] session user:", newSession?.user?.id);
        }

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
          setAppRole("user");
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
        isLoadingRole,
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
