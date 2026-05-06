import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
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
  adminCheckError: string | null; // null = sem erro, string = mensagem de erro
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp:
    (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  retryAdminCheck: () => void;
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
  const [adminCheckError, setAdminCheckError] = useState<string | null>(null);

  const lastRoleLoadForUserRef = useRef<string | null>(null);
  const sessionUserIdRef = useRef<string | null>(null);
  const isAdminRef = useRef<boolean | null>(null);

  // Guard para evitar reentrância de loadAdminStatus
  const loadingRoleRef = useRef<string | null>(null);

  // Tracks whether loadAdminStatus has successfully resolved for a given userId.
  // When true for the current user, TOKEN_REFRESHED skips the re-load entirely,
  // avoiding the setIsLoadingRole(true) → ProtectedRoute unmount → reset cascade.
  const roleResolvedForUserRef = useRef<string | null>(null);

  // Flag to prevent onAuthStateChange from setting authReady while init() is still running.
  const initRunningRef = useRef(true);

  // Guard: refreshSession() já foi feita nesta tentativa (evita loop)
  const refreshedInAttemptRef = useRef(false);


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

  // Detecta erros que indicam token expirado/inválido (JWT, 401, 403)
  const isAuthError = (err: unknown): boolean => {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (
        msg.includes('jwt') ||
        msg.includes('invalid refresh token') ||
        msg.includes('refresh token not found') ||
        msg.includes('token is expired') ||
        msg.includes('401') ||
        msg.includes('403')
      ) return true;
    }
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const status = (err as any).status;
      if (status === 401 || status === 403) return true;
    }
    if (typeof err === 'object' && err !== null && 'code' in err) {
      const code = (err as any).code;
      if (code === 'PGRST301' || code === '401' || code === '403') return true;
    }
    if (typeof err === 'object' && err !== null && 'message' in err) {
      const msg = ((err as any).message || '').toLowerCase();
      if (msg.includes('jwt') || msg.includes('invalid') || msg.includes('expired')) return true;
    }
    return false;
  };

  // Detecta erros transitórios que justificam retry (timeout, rede, 5xx, auth expirado)
  const isTransientError = (err: unknown): boolean => {
    if (isAuthError(err)) return true;
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('timeout') || msg.includes('abort') || msg.includes('networkerror') || msg.includes('failed to fetch')) return true;
    }
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const status = (err as any).status;
      if (typeof status === 'number' && status >= 500) return true;
    }
    return false;
  };

  // Detecta erros de refresh token invalidado definitivamente (deve fazer signOut)
  const isRefreshTokenInvalid = (err: unknown): boolean => {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes('invalid refresh token') || msg.includes('refresh token not found');
    }
    if (typeof err === 'object' && err !== null && 'message' in err) {
      const msg = ((err as any).message || '').toLowerCase();
      return msg.includes('invalid refresh token') || msg.includes('refresh token not found');
    }
    return false;
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Tenta refreshSession() uma vez. Se o refresh token é inválido, faz signOut.
   * Retorna a nova sessão ou null se falhou.
   */
  const tryRefreshSession = async (): Promise<Session | null> => {
    try {
      if (isDev) console.log('[AUTH] Tentando refreshSession()...');
      const { data, error } = await withTimeout(
        supabase.auth.refreshSession(),
        8000,
        'refreshSession'
      );
      if (error) {
        if (isDev) console.warn('[AUTH] refreshSession error:', error.message);
        // Se refresh token é inválido, sessão está morta
        if (isRefreshTokenInvalid(error)) {
          if (isDev) console.error('[AUTH] Refresh token inválido — forçando signOut');
          try { await supabase.auth.signOut(); } catch {}
          return null;
        }
        return null;
      }
      const newSession = data?.session ?? null;
      if (newSession) {
        if (isDev) console.log('[AUTH] refreshSession sucesso — token renovado');
        setSession(newSession);
        setUser(newSession.user);
        sessionUserIdRef.current = newSession.user.id;
      }
      return newSession;
    } catch (e) {
      if (isDev) console.warn('[AUTH] refreshSession exceção:', e);
      return null;
    }
  };

  // Carrega status de admin e companyId
  const loadAdminStatus = async (userId: string, { force = false }: { force?: boolean } = {}) => {
    // Evita chamadas duplicadas concorrentes para o mesmo userId
    if (loadingRoleRef.current === userId) {
      if (isDev) console.log('[AUTH] loadAdminStatus skipped: already loading for', userId);
      return;
    }

    // Se o role já foi resolvido com sucesso para este user e não é force,
    // não refaz a query — evita flash de loading ao trocar de aba.
    if (!force && roleResolvedForUserRef.current === userId) {
      if (isDev) console.log('[AUTH] loadAdminStatus skipped: already resolved for', userId);
      return;
    }

    loadingRoleRef.current = userId;
    lastRoleLoadForUserRef.current = userId;
    setIsLoadingRole(true);
    setAdminCheckError(null);

    try {
      let isAdminValue = false;
      let lastError: unknown = null;
      let loadedCompanyId: string | null = null;
      const MAX_RETRIES = 2;
      refreshedInAttemptRef.current = false;

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

          // Se erro de auth (401/403/JWT) e ainda não fez refresh neste ciclo, faz refresh antes do próximo retry
          if (isAuthError(e) && !refreshedInAttemptRef.current && attempt < MAX_RETRIES) {
            refreshedInAttemptRef.current = true;

            // Se refresh token inválido — sessão morta, não adianta continuar
            if (isRefreshTokenInvalid(e)) {
              if (isDev) console.error('[AUTH] Refresh token inválido detectado na query — abortando');
              break;
            }

            const newSession = await tryRefreshSession();
            if (!newSession) {
              if (isDev) console.warn('[AUTH] refreshSession falhou dentro de loadAdminStatus — continuando retry');
            }
            await delay(500);
            continue;
          }

          // Só faz retry para erros transitórios e se não for a última tentativa
          if (isTransientError(e) && attempt < MAX_RETRIES) {
            await delay(1000 * (attempt + 1)); // backoff progressivo
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
        setAdminCheckError(null);
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
        // Erro persistente após retries.
        // NÃO rebaixar para isAdmin=false definitivamente quando é erro transitório.
        // Manter último valor conhecido (isAdminRef.current) se existia, ou null se nunca resolveu.
        const errorMsg = lastError instanceof Error ? lastError.message : 'Erro ao verificar permissões';
        if (isDev) {
          console.error(`[AUTH] loadAdminStatus erro após retries:`, lastError);
        }

        const lastKnown = isAdminRef.current;
        if (lastKnown !== null) {
          // Já tinha um valor válido anterior — mantém para não rebaixar
          if (isDev) console.log(`[AUTH] Mantendo último isAdmin conhecido: ${lastKnown}`);
          setIsAdmin(lastKnown);
          setAppRole(lastKnown ? 'admin' : 'user');
        } else {
          // Nunca resolveu — fica como null (verificando), sem assumir false
          setIsAdmin(null);
          setAppRole(null);
        }
        setAdminCheckError(errorMsg);
        // NÃO marca como resolvido — permitir retry manual
        roleResolvedForUserRef.current = null;
      }
    } catch (e) {
      if (isDev) {
        console.error(`[AUTH] loadAdminStatus erro inesperado:`, e);
      }
      const errorMsg = e instanceof Error ? e.message : 'Erro inesperado ao verificar permissões';

      const lastKnown = isAdminRef.current;
      if (lastKnown !== null) {
        setIsAdmin(lastKnown);
        setAppRole(lastKnown ? 'admin' : 'user');
      } else {
        setIsAdmin(null);
        setAppRole(null);
      }
      setAdminCheckError(errorMsg);
      roleResolvedForUserRef.current = null;
    } finally {
      loadingRoleRef.current = null;
      setIsLoadingRole(false);
    }
  };

  // Função de retry exposta ao consumidor (ProfileMenu, etc.)
  const retryAdminCheck = useCallback(() => {
    const userId = sessionUserIdRef.current;
    if (!userId) return;
    if (isDev) console.log('[AUTH] retryAdminCheck triggered for', userId);
    // Limpa role resolvido e guard de refresh para forçar re-execução limpa
    roleResolvedForUserRef.current = null;
    refreshedInAttemptRef.current = false;
    void loadAdminStatus(userId, { force: true });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      initRunningRef.current = true;
      setIsLoading(true);
      setIsLoadingRole(false);
      
      if (isDev) {
        console.log("[AUTH] Iniciando autenticação...");
      }

      try {
        // 1) Recupera sessão do localStorage
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          8000,
          'getSession'
        );
        const { data, error } = sessionResult as any;

        if (cancelled) return;

        if (error) {
          if (isDev) {
            console.error("[AUTH] getSession error:", error);
          }
          setUser(null);
          setSession(null);
          setIsAdmin(false);
          isAdminRef.current = false;
          setCompanyId(null);
          setAppRole(null);
          setIsLoading(false);
          setAuthReady(true);
          initRunningRef.current = false;
          return;
        }

        let currentSession: Session | null = data?.session ?? null;

        // 2) Se tem sessão salva, faz refreshSession() para garantir JWT válido
        //    ANTES de consultar admin_users. Isso resolve o caso de JWT expirado no bootstrap.
        if (currentSession) {
          if (isDev) console.log('[AUTH] Sessão encontrada no localStorage — validando com refreshSession...');
          try {
            const refreshResult = await withTimeout(
              supabase.auth.refreshSession(),
              8000,
              'init.refreshSession'
            );
            if (refreshResult.error) {
              if (isDev) console.warn('[AUTH] refreshSession no init falhou:', refreshResult.error.message);

              // Se refresh token é inválido, sessão morta → logout
              if (isRefreshTokenInvalid(refreshResult.error)) {
                if (isDev) console.error('[AUTH] Refresh token inválido no bootstrap — forçando logout');
                try { await supabase.auth.signOut(); } catch {}
                setUser(null);
                setSession(null);
                setIsAdmin(false);
                isAdminRef.current = false;
                setCompanyId(null);
                setAppRole(null);
                setIsLoading(false);
                setAuthReady(true);
                initRunningRef.current = false;
                return;
              }
              // Outros erros de refresh: continua com a sessão existente (pode funcionar se não expirou)
            } else if (refreshResult.data?.session) {
              // Sucesso: usa sessão renovada
              currentSession = refreshResult.data.session;
              if (isDev) console.log('[AUTH] refreshSession sucesso — JWT renovado para bootstrap');
            }
          } catch (refreshErr) {
            // Timeout ou erro de rede no refresh — continua com sessão existente
            if (isDev) console.warn('[AUTH] refreshSession exceção no init:', refreshErr);
          }
        }

        if (cancelled) return;

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
          if (!cancelled) {
            setAuthReady(true);
          }
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
        if (!cancelled) {
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
      } finally {
        initRunningRef.current = false;
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
            setAdminCheckError(null);
            roleResolvedForUserRef.current = null;
            refreshedInAttemptRef.current = false;
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
          setAdminCheckError(null);
          roleResolvedForUserRef.current = null;
        }

        // Só seta authReady/isLoading aqui se init() já terminou.
        // Se init() ainda está rodando, ele cuidará de setar authReady
        // após loadAdminStatus completar — evitando a race condition.
        if (!initRunningRef.current) {
          setIsLoading(false);
          setAuthReady(true);
        }
      }
    );

    // visibilitychange removido intencionalmente.
    // O Supabase client (autoRefreshToken: true) cuida do refresh de token em background.
    // O handler anterior causava re-execução de loadAdminStatus em toda troca de aba,
    // o que gerava re-renders e o efeito de "reset" da página ao voltar para ela.

    return () => {
      cancelled = true;
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
    setAdminCheckError(null);
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
        adminCheckError,
        signIn,
        signUp,
        signOut,
        retryAdminCheck,
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
