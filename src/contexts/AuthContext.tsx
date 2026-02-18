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


let authInitCount = 0;
let authListenerCount = 0;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [appRole, setAppRole] = useState<AppRole | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRole, setIsLoadingRole] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  // Guard para evitar reentrância de loadRoleAndCompany
  const loadingRoleRef = useRef<string | null>(null);

  const clearSupabaseStorage = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        useEffect(() => {
          authInitCount++;
          if (isDev) console.log(`[AUTH] useEffect init count: ${authInitCount}`);
          let unsub: (() => void) | undefined;
          let cancelled = false;
          const init = async () => {
            setIsLoading(true);
            setIsLoadingRole(false);
            if (isDev) console.log("[AUTH] Iniciando autenticação...");
            try {
              let timeoutId: number | undefined;
              let timeoutOccurred = false;
              const sessionPromise = supabase.auth.getSession();
              const timeoutPromise = new Promise<never>((_resolve, reject) => {
                timeoutId = window.setTimeout(() => {
                  timeoutOccurred = true;
                  reject(new Error("getSession: timeout de proteção 30s"));
                }, 30000);
              });
              let sessionResult: { data: { session: Session | null }; error: any };
              try {
                sessionResult = await Promise.race([sessionPromise, timeoutPromise]);
              } catch (e) {
                if (timeoutOccurred) {
                  if (isDev) {
                    console.warn("[AUTH] Timeout na recuperação de sessão após 30s. Permitindo que o app continue, sessão será atualizada quando disponível.");
                  }
                  sessionResult = { data: { session: null }, error: null };
                } else {
                  throw e;
                }
              } finally {
                if (timeoutId !== undefined) window.clearTimeout(timeoutId);
              }
              const { data, error } = sessionResult;
              if (error) {
                if (isDev) console.error("[AUTH] getSession error:", error);
                setUser(null);
                setSession(null);
                setIsAdmin(false);
                setCompanyId(null);
                setAppRole(null);
                setIsLoading(false);
                setAuthReady(true);
                return;
              }
              const currentSession = data?.session ?? null;
              setSession(currentSession);
              setUser(currentSession?.user ?? null);
              if (isDev) console.log("[AUTH] userId:", currentSession?.user?.id);
              setIsLoading(false);
              setAuthReady(true);
              if (currentSession?.user?.id) {
                await loadAdminStatus(currentSession.user.id);
              } else {
                setIsAdmin(false);
                setCompanyId(null);
                setAppRole(null);
              }
            } catch (e) {
              if (isDev) console.error("[AUTH] Auth init falhou:", e);
              setUser(null);
              setSession(null);
              setIsAdmin(false);
              setCompanyId(null);
              setAppRole(null);
              setIsLoading(false);
              setAuthReady(true);
            }
          };
          void init();
          // Listener de mudanças de autenticação
          const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
            authListenerCount++;
            if (isDev) console.log(`[AUTH] onAuthStateChange count: ${authListenerCount}`);
            if (isDev) console.log("[AUTH] onAuthStateChange event:", _event);
            setSession(newSession);
            setUser(newSession?.user ?? null);
            if (isDev) console.log("[AUTH] userId:", newSession?.user?.id);
            if (newSession?.user?.id) {
              setIsAdmin(false);
              setCompanyId(null);
              setAppRole(null);
              await loadAdminStatus(newSession.user.id);
            } else {
              setIsAdmin(false);
              setCompanyId(null);
              setAppRole(null);
            }
            setIsLoading(false);
            setAuthReady(true);
          });
          unsub = () => authListener.subscription.unsubscribe();
          return () => { if (unsub) unsub(); cancelled = true; };
        }, []);
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
      {authReady ? children : null}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
