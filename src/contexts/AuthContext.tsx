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
    try {
      localStorage.removeItem("lastKnownAdmin");
    } catch {
      // ignore
    }
  };

  /**
   * Carrega admin status a partir da tabela admin_users.
   * - Busca em admin_users (user_id) para verificar se é admin
   * - Retry 2x com delays progressivos se falhar por rede/timeout
   * - NÃO seta isAdmin=false por erro - mantém estado anterior
   * - Só seta isAdmin=false quando a query retorna null explicitamente
   * - Carrega company_id de company_users em paralelo
   */
  const loadAdminStatus = async (userId: string) => {
    // Evitar reentrância
    if (loadingRoleRef.current === userId) {
      if (isDev) {
        console.warn(
          `[AUTH] loadAdminStatus já em execução para ${userId}, ignorando chamada`
        );
      }
      return;
    }

    loadingRoleRef.current = userId;
    setIsLoadingRole(true);

    let isAdminValue = false;
    let loadedCompanyId: string | null = null;
    let lastError: Error | null = null;

    try {
      let attempt = 1;
      const maxAttempts = 2;
      const delays = [500, 1500]; // ms entre tentativas

      while (attempt <= maxAttempts) {
        try {
          if (isDev) {
            console.log(`[AUTH] loadAdminStatus tentativa ${attempt}/${maxAttempts}`);
          }

          // Query: Buscar se user_id existe em admin_users
          // Usando type casting (as any) pois admin_users pode ser tabela custom
          const adminRes = await supabase
            .from("admin_users" as any)
            .select("user_id")
            .eq("user_id", userId)
            .maybeSingle() as any;

          // Se houve erro (RLS, connection, etc)
          if (adminRes.error) {
            if (adminRes.error.code === "PGRST116") {
              // Sem dados - user não é admin (esperado para maioria dos usuários)
              isAdminValue = false;
              if (isDev) {
                console.log(`[AUTH] userId não encontrado em admin_users: ${userId}`);
              }
            } else {
              // Erro real (RLS, connection, etc) - não é dado vazio
              lastError = new Error(`admin_users query error: ${adminRes.error.message}`);
              if (isDev) {
                console.error(`[AUTH] admin_users error:`, adminRes.error);
              }
              // Não seta isAdmin - mantém estado anterior
              throw lastError;
            }
          } else if (adminRes.data) {
            // user_id encontrado - é admin
            isAdminValue = true;
            if (isDev) {
              console.log(`[AUTH] userId encontrado em admin_users: ${userId}`);
            }
          } else {
            // Sem dados e sem erro - user não é admin
            isAdminValue = false;
            if (isDev) {
              console.log(`[AUTH] userId não é admin: ${userId}`);
            }
          }

          // Se conseguiu obter resultado claro (com ou sem erro PGRST116), sai do loop
          if (!lastError || (lastError && lastError.message.includes("PGRST116"))) {
            // Query bem-sucedida ou sem dados (esperado)
            lastError = null; // Limpa o erro PGRST116 pois é esperado
            break;
          }

          // Se erro real, tenta novamente
          if (attempt < maxAttempts) {
            const delay = delays[attempt - 1];
            if (isDev) {
              console.warn(
                `[AUTH] loadAdminStatus falhou na tentativa ${attempt}/${maxAttempts}, ` +
                  `retentando em ${delay}ms`
              );
            }
            await new Promise((r) => setTimeout(r, delay));
            attempt++;
          } else {
            throw lastError || new Error("Não foi possível carregar status de admin");
          }
        } catch (e) {
          if (attempt < maxAttempts) {
            const delay = delays[attempt - 1];
            if (isDev) {
              console.warn(
                `[AUTH] loadAdminStatus falhou na tentativa ${attempt}/${maxAttempts}, ` +
                  `retentando em ${delay}ms:`,
                e
              );
            }
            await new Promise((r) => setTimeout(r, delay));
            attempt++;
          } else {
            // Saiu do loop - mantem erro anterior, não força false
            if (isDev) {
              console.error(`[AUTH] loadAdminStatus falhou após múltiplas tentativas:`, e);
            }
            // NÃO seta isAdmin para false - apenas registra erro
          }
        }
      }

      // Se conseguiu carregar com sucesso, atualiza estado
      if (!lastError) {
        setIsAdmin(isAdminValue);
        setAppRole(isAdminValue ? "admin" : "user");

        // Persistir último estado admin para permitir ações de recuperação
        // mesmo quando a checagem de role estiver em loading.
        try {
          if (isAdminValue) localStorage.setItem("lastKnownAdmin", "1");
          else localStorage.removeItem("lastKnownAdmin");
        } catch {
          // ignore
        }

        if (isDev) {
          console.log(`[AUTH] userId=${userId}, isAdmin=${isAdminValue}`);
        }

        // Carrega company_id (secundário)
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
            setCompanyId(loadedCompanyId);
            if (isDev) {
              console.log(`[AUTH] companyId encontrado: ${loadedCompanyId}`);
            }
          }
        } catch (e) {
          if (isDev) {
            console.warn(`[AUTH] company_users error:`, e);
          }
          // Não é crítico se company_id não carregar
        }
      } else {
        // Erro - não atualiza isAdmin, mantém estado anterior
        if (isDev) {
          console.error(`[AUTH] loadAdminStatus erro, mantendo estado anterior:`, lastError);
        }
      }
    } catch (e) {
      // Erro não esperado
      if (isDev) {
        console.error(`[AUTH] loadAdminStatus erro inesperado:`, e);
      }
      // NÃO força fallback
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
          console.log("[AUTH] userId:", currentSession?.user?.id);
        }

        // Libera loading - UI não fica travada enquanto admin status é carregado
        setIsLoading(false);

        // SEMPRE carrega admin status após obter a sessão
        if (currentSession?.user?.id) {
          await loadAdminStatus(currentSession.user.id);
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
          console.log("[AUTH] userId:", newSession?.user?.id);
        }

        // Reset admin status ao trocar usuário
        if (newSession?.user?.id) {
          setIsAdmin(false);
          setCompanyId(null);
          setAppRole(null);
          // Recarrega admin status para novo usuário
          await loadAdminStatus(newSession.user.id);
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
