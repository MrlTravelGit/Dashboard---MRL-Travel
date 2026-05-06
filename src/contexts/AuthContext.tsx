import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "admin" | "user";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean | null; // null = verificando, true = admin, false = não-admin
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [appRole, setAppRole] = useState<AppRole | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRole, setIsLoadingRole] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const lastRoleLoadForUserRef = useRef<string | null>(null);
  const sessionUserIdRef = useRef<string | null>(null);
  const isAdminRef = useRef<boolean | null>(null);

  // Guard para evitar reentrância de loadRoleAndCompany
  const loadingRoleRef = useRef<string | null>(null);

  // Tracks whether loadAdminStatus has successfully resolved for a given userId.
  // When true for the current user, TOKEN_REFRESHED skips the re-load entirely,
  // avoiding the setIsLoadingRole(true) → ProtectedRoute unmount → reset cascade.
  const roleResolvedForUserRef = useRef<string | null>(null);



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

  // Detecta erros transitórios que justificam retry (timeout, rede, 5xx)
  const isTransientError = (err: unknown): boolean => {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('timeout') || msg.includes('abort') || msg.includes('networkerror') || msg.includes('failed to fetch')) return true;
    }
    // Supabase errors com status 5xx
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const status = (err as any).status;
      if (typeof status === 'number' && status >= 500) return true;
    }
    return false;
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Carrega status de admin e companyId
  const loadAdminStatus = async (userId: string, { force = false }: { force?: boolean } = {}) => {
    // Evita chamadas duplicadas para o mesmo userId em sequência
    if (lastRoleLoadForUserRef.current === userId && (isLoadingRole || loadingRoleRef.current === userId)) {
      return;
    }

    // Se o role já foi resolvido com sucesso para este user e não é force,
    // não refaz a query — evita flash de loading ao trocar de aba.
    if (!force && roleResolvedForUserRef.current === userId) {
      return;
    }

    lastRoleLoadForUserRef.current = userId;
    setIsLoadingRole(true);
    try {
      let isAdminValue = false;
      let lastError: unknown = null;
      let loadedCompanyId: string | null = null;
      const MAX_RETRIES = 2;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        lastError = null;
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
            if (!rolesRes.error) {
              isAdminValue = rolesRes.data?.role === 'admin';
            }
          }
          // Sucesso — sai do loop de retry
          break;
        } catch (e) {
          lastError = e;
          if (isDev) {
            console.warn(`[AUTH] loadAdminStatus tentativa ${attempt + 1}/${MAX_RETRIES + 1} falhou:`, e);
          }
          // Só faz retry para erros transitórios e se não for a última tentativa
          if (isTransientError(e) && attempt < MAX_RETRIES) {
            await delay(1000);
            continue;
          }
          // Erro não-transitório ou última tentativa — para de tentar
          break;
        }
      }
      if (!lastError) {
        setIsAdmin(isAdminValue);
        isAdminRef.current = isAdminValue;
        setAppRole(isAdminValue ? 'admin' : 'user');
        // Mark role as successfully resolved for this user
        roleResolvedForUserRef.current = userId;
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
        // Erro persistente: isAdmin fica null ("verificando") em vez de cair em false
        if (isDev) {
          console.error(`[AUTH] loadAdminStatus erro após retries, isAdmin permanece null:`, lastError);
        }
        // Não seta isAdmin=false — mantém null para que a UI mostre estado de verificação
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

        // Libera isLoading (sessão já foi recuperada)
        setIsLoading(false);

        if (currentSession?.user?.id) {
          // CRITICAL FIX: resolve admin status ANTES de setar authReady.
          // Isso impede que a UI renderize com isAdmin=null/false antes da verificação.
          await loadAdminStatus(currentSession.user.id);
          setAuthReady(true);
        } else {
          // Sem usuário autenticado, reseta estado
          setIsAdmin(false);
          isAdminRef.current = false;
          setCompanyId(null);
          setAppRole(null);
          setAuthReady(true);
        }
      } catch (e) {
        if (isDev) {
          console.error("[AUTH] Auth init falhou:", e);
        }
        // Mantém app utilizável - timeout/erro de rede não força logout
        setUser(null);
        setSession(null);
        setIsAdmin(null);
        isAdminRef.current = null;
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

        if (nextUserId) {
          if (nextUserId !== prevUserId) {
            // Mudou de usuário: resetar permissões e recarregar
            setIsAdmin(null);
            isAdminRef.current = null;
            setCompanyId(null);
            setAppRole(null);
            roleResolvedForUserRef.current = null;
            await loadAdminStatus(nextUserId, { force: true });
          }
          // TOKEN_REFRESHED / INITIAL_SESSION com mesmo user:
          // NÃO recarregar admin status — evita flash de loading e unmount das rotas.
          // O role já foi carregado com sucesso no init() ou no login anterior.
        } else {
          // Logout
          setIsAdmin(null);
          isAdminRef.current = null;
          setCompanyId(null);
          setAppRole(null);
          roleResolvedForUserRef.current = null;
        }

        setIsLoading(false);
        setAuthReady(true);
      }
    );

    // visibilitychange removido intencionalmente.
    // O Supabase client (autoRefreshToken: true) cuida do refresh de token em background.
    // O handler anterior causava re-execução de loadAdminStatus em toda troca de aba,
    // o que gerava re-renders e o efeito de "reset" da página ao voltar para ela.

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
    sessionUserIdRef.current = null;
    setIsAdmin(null);
    isAdminRef.current = null;
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
