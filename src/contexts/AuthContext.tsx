import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

type AppRole = "admin" | "user";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  appRole: AppRole | null;
  companyId: string | null;
  isLoading: boolean;
  isLoadingRole: boolean;
  authReady: boolean;
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
        if (k && k.startsWith('sb-')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      if (isDev) console.warn('[AUTH] clearSupabaseStorage error:', e);
    }
  };

  const getSessionSafe = async (timeoutMs: number) => {
    let timeoutId: number | undefined;
    let timeoutOccurred = false;

    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        timeoutOccurred = true;
        reject(new Error(`getSession: timeout de proteção ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([sessionPromise, timeoutPromise]);
    } catch (e) {
      if (timeoutOccurred) {
        return { data: { session: null }, error: null } as const;
      }
      throw e;
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  };

  // Carrega status de admin e companyId
  const loadAdminStatus = async (userId: string) => {
    setIsLoadingRole(true);
    try {
      // Simula chamada para verificar admin
      let isAdminValue = false;
      let lastError = null;
      let loadedCompanyId: string | null = null;
      try {
        // Checa se o usuário existe na tabela admin_users (public.admin_users)
        const { data, error } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        isAdminValue = !!data?.user_id;
      } catch (e) {
        lastError = e;
        if (isDev) {
          console.error(`[AUTH] loadAdminStatus falhou após múltiplas tentativas:`, e);
        }
      }
      if (!lastError) {
        setIsAdmin(isAdminValue);
        setAppRole(isAdminValue ? 'admin' : 'user');
        if (isDev) {
          console.log(`[AUTH] userId=${userId}, isAdmin=${isAdminValue}`);
        }
        // Carrega company_id (secundário)
        try {
          const companyRes = await supabase
            .from('company_users')
            .select('company_id')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
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
        }
      } else {
        if (isDev) {
          console.error(`[AUTH] loadAdminStatus erro, mantendo estado anterior:`, lastError);
        }
      }
    } catch (e) {
      if (isDev) {
        console.error(`[AUTH] loadAdminStatus erro inesperado:`, e);
      }
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
        let sessionResult: {
          data: { session: Session | null };
          error: any;
        };
        // 1) tenta recuperar sessão com timeout.
        sessionResult = await getSessionSafe(30000);

        // 2) Se veio null por timeout, limpa storage do supabase e tenta mais uma vez.
        // Isso resolve casos em que o localStorage do supabase corrompe e o app fica carregando infinito.
        if (!sessionResult.data.session) {
          try {
            clearSupabaseStorage();
          } catch {
            // noop
          }
          // segunda tentativa mais curta, para não travar novamente
          sessionResult = await getSessionSafe(8000);
        }

        const { data, error } = sessionResult;

        if (error) {
          if (isDev) {
            console.error("[AUTH] getSession error:", error);
          }
          // Se deu erro, tenta limpar storage para evitar loop em próximos loads.
          clearSupabaseStorage();
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

        if (isDev) {
          console.log("[AUTH] userId:", currentSession?.user?.id);
        }

        // Libera loading. A UI não fica travada enquanto admin status é carregado.
        setIsLoading(false);

        // A partir daqui, o AuthProvider já inicializou (com ou sem sessão).
        // Isso evita a tela azul/blank quando authReady nunca é liberado.
        setAuthReady(true);

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
        clearSupabaseStorage();
        // Mantém app utilizável - timeout/erro de rede não força logout
        setUser(null);
        setSession(null);
        setIsAdmin(false);
        setCompanyId(null);
        setAppRole(null);
        setIsLoading(false);

        // Mesmo com erro/timeout, liberamos a UI para o app continuar utilizável.
        setAuthReady(true);
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

        // Garante que a UI não fique presa antes do primeiro evento.
        setAuthReady(true);

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

  const resetAuthState = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      if (isDev) console.warn('[AUTH] signOut error:', e);
    }
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    setCompanyId(null);
    setAppRole(null);
    setIsLoading(false);
    setIsLoadingRole(false);
    // authReady significa "AuthProvider inicializado". Após signOut, ele deve permanecer true.
    setAuthReady(true);
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
        authReady,
        signIn,
        signUp,
        signOut,
      }}
    >
      {authReady ? (
        children
      ) : (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
