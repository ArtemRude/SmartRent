import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/domain";

type Profile = { id: string; name: string; email: string; phone: string | null };

type AuthValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue>({
  session: null,
  user: null,
  profile: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async (uid: string | undefined) => {
      if (!uid) {
        if (active) {
          setProfile(null);
          setRole(null);
        }
        return;
      }
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("id,name,email,phone").eq("id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid).limit(1).maybeSingle(),
      ]);
      if (!active) return;
      setProfile((p as Profile) ?? null);
      setRole(((r?.role as AppRole) ?? null) as AppRole | null);
    };

    const syncSession = async (next: Session | null) => {
      if (!active) return;
      setLoading(true);
      setSession(next);
      await load(next?.user?.id);
      if (active) setLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "SIGNED_OUT") queryClient.clear();
      queueMicrotask(() => void syncSession(next));
    });

    supabase.auth.getSession().then(({ data }) => void syncSession(data.session));

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    setProfile(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, role, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
