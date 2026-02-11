import React, { createContext, useContext, useEffect, useState } from "react";
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

  const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string) => {
    let t: number | undefined;
    const timeout = new Promise<T>((_resolve, reject) => {
      t = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (t) window.clearTimeout(t);
    }
  };

  const loadRoleAndCompany = async (userId: string) => {
    try {
      const adminPromise = supabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      const companyPromise = supabase
        .from("company_users")
        .select("company_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const [{ data: adminRow }, { data: cu }] = await withTimeout(
        Promise.all([adminPromise, companyPromise]),
        7000,
        "loadRoleAndCompany"
      );

      const admin = !!adminRow;
      setIsAdmin(admin);
      setAppRole(admin ? "admin" : "user");
      setCompanyId(cu?.company_id ?? null);
    } catch (e) {
      console.error("Error loading role/company:", e);
      setIsAdmin(false);
      setCompanyId(null);
      setAppRole(null);
    }
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          7000,
          "getSession"
        );

        if (error) {
          console.error("getSession error:", error);
          await resetAuthState();
          return;
        }

        const currentSession = data.session ?? null;
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
        console.error("Auth init failed:", e);
        await resetAuthState();
      } finally {
        setIsLoading(false);
      }
    };

    void init();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user?.id) {
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
