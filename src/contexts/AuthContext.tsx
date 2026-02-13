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
   * Carrega role (admin/user) e company_id com retry e fallback inteligente.
   * - Busca em user_roles (fonte primária)
   * - Se falhar: mantém estado anterior (NÃO força fallback para "user")
   * - Retry 2x com delays progressivos se falhar por rede/timeout
   * - Evita reentrância com useRef guard
   * - Sem chamadas a Edge Functions (evita 404 em produção)
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

    let loadedRole: AppRole | null = null;
    let loadedCompanyId: string | null = null;
    let lastError: Error | null = null;

    try {
      let attempt = 1;
      const maxAttempts = 2;
      const delays = [500, 1500]; // ms entre tentativas

      while (attempt <= maxAttempts && !loadedRole) {
        try {
          if (isDev) {
            console.log(`[AUTH] loadRoleAndCompany tentativa ${attempt}/${maxAttempts}`);
          }

          // Query 1: Buscar role na tabela user_roles (fonte primária)
          const roleRes = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .maybeSingle();

          if (roleRes.error) {
            if (roleRes.error.code === "PGRST116") {
              // Sem dados - não é erro crítico, mas user não tem role definida
              if (isDev) {
                console.log(`[AUTH] user_roles: sem dados para user ${userId}`);
              }
              lastError = new Error("Nenhuma role encontrada para este usuário");
            } else {
              // Erro real (RLS, connection, etc)
              lastError = new Error(`user_roles query error: ${roleRes.error.message}`);
              if (isDev) {
                console.error(`[AUTH] user_roles error:`, roleRes.error);
              }
            }
          } else if (roleRes.data?.role) {
            loadedRole = roleRes.data.role as AppRole;
            if (isDev) {
              console.log(`[AUTH] role encontrada em user_roles: ${loadedRole}`);
            }

            // Query 2: Buscar company_id (primeira empresa associada)
            try {
              const companyRes = await supabase
                .from("company_users")
                .select("company_id")
                .eq("user_id", userId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

              if (companyRes.data?.company_id) {
                loadedCompanyId = companyRes.data.company_id;
                if (isDev) {
                  console.log(
                    `[AUTH] companyId encontrado em company_users: ${loadedCompanyId}`
                  );
                }
              } else if (isDev && companyRes.error?.code !== "PGRST116") {
                console.warn(`[AUTH] company_users error:`, companyRes.error);
              }
            } catch (e) {
              if (isDev) {
                console.error(`[AUTH] company_users exception:`, e);
              }
              // Não é crítico se company_id não carregar
            }
          }

          // Se conseguiu carregar a role, sai do loop de retry
          if (loadedRole) {
            break;
          }

          // Se não conseguiu, tenta novamente
          if (attempt < maxAttempts) {
            const delay = delays[attempt - 1];
            if (isDev) {
              console.warn(
                `[AUTH] Role não carregada na tentativa ${attempt}/${maxAttempts}, ` +
                  `retentando em ${delay}ms`
              );
            }
            await new Promise((r) => setTimeout(r, delay));
            attempt++;
          } else {
            // Saiu do loop sem conseguir
            throw lastError || new Error("Role não foi carregada após múltiplas tentativas");
          }
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

      // Se carregou a role com sucesso, atualiza estado
      if (loadedRole) {
        setAppRole(loadedRole);
        setIsAdmin(loadedRole === "admin");
        setCompanyId(loadedCompanyId);

        if (isDev) {
          console.log(
            `[AUTH] role=${loadedRole}, isAdmin=${loadedRole === "admin"}, companyId=${loadedCompanyId}`
          );
        }
      } else {
        // Não conseguiu carregar - mantém estado anterior (não força "user")
        if (isDev) {
          console.error(
            `[AUTH] loadRoleAndCompany falhou após múltiplas tentativas:`,
            lastError
          );
        }
        // NÃO fazemos fallback automático para "user"
        // Mantemos appRole como null até conseguir carregar
      }
    } catch (e) {
      // Erro não esperado - log completo
      if (isDev) {
        console.error(
          `[AUTH] loadRoleAndCompany erro inesperado:`,
          e
        );
      }
      // NÃO força fallback - mantém estado anterior
    } finally {
      loadingRoleRef.current = null;
      setIsLoadingRole(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      setIsLoadingRole(false);
      
      if (isDev) {
        console.log("[AUTH] Iniciando autenticação...");
      }

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
          setAppRole(null);
          setIsLoading(false);
          return;
        }

        const currentSession = data?.session ?? null;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (isDev) {
          console.log("[AUTH] user:", currentSession?.user?.id);
        }

        // Libera loading - UI não fica travada enquanto role é carregada
        setIsLoading(false);

        // SEMPRE carrega role/company após obter a sessão
        if (currentSession?.user?.id) {
          await loadRoleAndCompany(currentSession.user.id);
        } else {
          // Sem usuário autenticado, reseta estado
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole(null);
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
        setAppRole(null);
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
          console.log("[AUTH] user:", newSession?.user?.id);
        }

        // Reset role/company ao trocar usuário
        if (newSession?.user?.id) {
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole(null);
          // Recarrega role/company para novo usuário
          await loadRoleAndCompany(newSession.user.id);
        } else {
          // Logout
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
