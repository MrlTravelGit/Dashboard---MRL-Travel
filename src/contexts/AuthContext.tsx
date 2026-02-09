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
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
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

  const loadRoleAndCompany = async (userId: string) => {
    // 1) tenta achar vínculo na company_users
    // Alguns projetos antigos usavam a coluna "app_role" em vez de "role".
    const { data, error } = await supabase
      .from("company_users")
      .select("company_id, role, app_role")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      setIsAdmin(false);
      setCompanyId(null);
      setAppRole(null);
      return;
    }

    const role = ((data as any).role ?? (data as any).app_role ?? "user") as AppRole;
    setCompanyId(data.company_id ?? null);
    setAppRole(role);
    setIsAdmin(role === "admin");
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      const { data } = await supabase.auth.getSession();
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

      setIsLoading(false);
    };

    void init();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
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
    });

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
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsAdmin(false);
    setCompanyId(null);
    setAppRole(null);
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
