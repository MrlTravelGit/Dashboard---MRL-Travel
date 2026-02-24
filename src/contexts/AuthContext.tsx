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

  const lastRoleLoadForUserRef = useRef<string | null>(null);
  const visibilityRefreshRunningRef = useRef(false);
  const sessionUserIdRef = useRef<string | null>(null);
  const isAdminRef = useRef<boolean>(false);

  // Guard para evitar reentrância de loadRoleAndCompany
  const loadingRoleRef = useRef<string | null>(null);



  const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timeoutId: number | undefined;
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  };

  // Carrega status de admin e companyId
  const loadAdminStatus = async (userId: string) => {
    // Evita chamadas duplicadas para o mesmo userId em sequência
    if (lastRoleLoadForUserRef.current === userId && (isLoadingRole || loadingRoleRef.current === userId)) {
      return;
    }

    lastRoleLoadForUserRef.current = userId;
    setIsLoadingRole(true);
    try {
      // Simula chamada para verificar admin
      let isAdminValue = false;
      let lastError = null;
      let loadedCompanyId: string | null = null;
      try {
        // Fonte principal: tabela admin_users (user_id)
        const adminRes = await withTimeout(
          supabase
            .from('admin_users')
            .select('user_id')
            .eq('user_id', userId)
            .maybeSingle(),
          8000,
          'loadAdminStatus(admin_users)'
        );
        if (adminRes.error) throw adminRes.error;
        isAdminValue = !!adminRes.data?.user_id;

        // Compatibilidade: se não for admin via admin_users, tenta user_roles (quando existir)
        if (!isAdminValue) {
          const rolesRes = await withTimeout(
            supabase
              .from('user_roles')
              .select('role')
              .eq('user_id', userId)
              .maybeSingle(),
            8000,
            'loadAdminStatus(user_roles)'
          );
          // Se a tabela user_roles não existir ou estiver bloqueada, não derruba o fluxo
          if (!rolesRes.error) {
            isAdminValue = rolesRes.data?.role === 'admin';
          }
        }
      } catch (e) {
        lastError = e;
        if (isDev) {
          console.error(`[AUTH] loadAdminStatus falhou após múltiplas tentativas:`, e);
        }
      }
      if (!lastError) {
        setIsAdmin(isAdminValue);
        isAdminRef.current = isAdminValue;
        setAppRole(isAdminValue ? 'admin' : 'user');
        try {
          if (isAdminValue) {
            localStorage.setItem('lastKnownAdmin', '1');
          } else {
            // Não força para 0 se já era admin, evita sumir botão em cenários de timeout.
            if (localStorage.getItem('lastKnownAdmin') !== '1') {
              localStorage.setItem('lastKnownAdmin', '0');
            }
          }
        } catch {}
        if (isDev) {
          console.log(`[AUTH] userId=${userId}, isAdmin=${isAdminValue}`);
        }
        // Carrega company_id (secundário)
        try {
          const companyRes = await withTimeout(
            supabase
              .from('company_users')
              .select('company_id')
              .eq('user_id', userId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            8000,
            'loadAdminStatus(company_users)'
          );
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
        // Recupera sessão com timeout curto para nunca travar ao trocar de aba.
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          8000,
          'getSession'
        );
        const { data, error } = sessionResult as any;

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
          setAuthReady(true);
          return;
        }

        const currentSession = data?.session ?? null;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        sessionUserIdRef.current = currentSession?.user?.id ?? null;

        if (isDev) {
          console.log("[AUTH] userId:", currentSession?.user?.id);
        }

        // Libera loading - UI não fica travada enquanto admin status é carregado
        setIsLoading(false);
        setAuthReady(true);

        // SEMPRE carrega admin status após obter a sessão
        if (currentSession?.user?.id) {
          await loadAdminStatus(currentSession.user.id);
        } else {
          // Sem usuário autenticado, reseta estado
          setIsAdmin(false);
          isAdminRef.current = false;
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
        isAdminRef.current = false;
        setCompanyId(null);
        setAppRole(null);
        setIsLoading(false);
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

        const prevUserId = sessionUserIdRef.current;
        const nextUserId = newSession?.user?.id ?? null;

        setSession(newSession);
        setUser(newSession?.user ?? null);
        sessionUserIdRef.current = nextUserId;

        if (isDev) {
          console.log("[AUTH] userId:", newSession?.user?.id);
        }

        // Só reseta permissões quando realmente mudou de usuário.
        // Em eventos como TOKEN_REFRESHED, manter o estado evita "perder admin" por falha temporária.
        if (nextUserId) {
          if (nextUserId !== prevUserId) {
            setIsAdmin(false);
            isAdminRef.current = false;
            setCompanyId(null);
            setAppRole(null);
          }
          await loadAdminStatus(nextUserId);
        } else {
          // Logout
          setIsAdmin(false);
          isAdminRef.current = false;
          setCompanyId(null);
          setAppRole(null);
        }

        setIsLoading(false);
        setAuthReady(true);
      }
    );

    // Ao voltar para a aba, tenta recuperar sessão rapidamente.
    // Importante: não pode colocar o app em loading infinito.
    const onVisibility = async () => {
      if (document.visibilityState !== 'visible') return;
      if (visibilityRefreshRunningRef.current) return;
      visibilityRefreshRunningRef.current = true;

      try {
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          6000,
          'getSession(visibilitychange)'
        );
        const nextSession: Session | null = (sessionResult as any)?.data?.session ?? null;

        // Atualiza somente se mudou, para evitar loops.
        const nextUserId = nextSession?.user?.id ?? null;
        const currentUserId = sessionUserIdRef.current;

        if (nextUserId !== currentUserId) {
          setSession(nextSession);
          setUser(nextSession?.user ?? null);
          sessionUserIdRef.current = nextUserId;
          setIsAdmin(false);
          isAdminRef.current = false;
          setCompanyId(null);
          setAppRole(null);
          if (nextUserId) await loadAdminStatus(nextUserId);
        } else if (nextUserId) {
          // Mesmo usuário: se o estado de admin caiu por algum motivo, tenta recuperar.
          // Importante: loadAdminStatus não deve derrubar isAdmin em caso de erro.
          let lastKnown: string | null = null;
          try {
            lastKnown = localStorage.getItem('lastKnownAdmin');
          } catch {
            lastKnown = null;
          }
          if (!isAdminRef.current && lastKnown === '1') {
            await loadAdminStatus(nextUserId);
          }
        }
      } catch (e) {
        if (isDev) console.warn('[AUTH] visibility refresh failed:', e);
        // Nunca trava o app
        setAuthReady(true);
      } finally {
        visibilityRefreshRunningRef.current = false;
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      authListener.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
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
    sessionUserIdRef.current = null;
    setIsAdmin(false);
    isAdminRef.current = false;
    setCompanyId(null);
    setAppRole(null);
    setIsLoading(false);
    setIsLoadingRole(false);
    setAuthReady(false);
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
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
