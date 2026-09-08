import { useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/domain";
import { AuthContext, type Profile } from "@/hooks/auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async (nextUser: User | undefined) => {
      if (!nextUser) {
        if (active) {
          setProfile(null);
          setRole(null);
        }
        return;
      }
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("id,name,email,phone").eq("id", nextUser.id).maybeSingle(),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", nextUser.id)
          .limit(1)
          .maybeSingle(),
      ]);
      if (!active) return;
      const metadataRole = nextUser.user_metadata["role"];
      const fallbackRole: AppRole = metadataRole === "tenant" ? "tenant" : "owner";
      setProfile((p as Profile) ?? null);
      setRole((r?.role as AppRole | undefined) ?? fallbackRole);
    };

    const syncSession = async (next: Session | null) => {
      if (!active) return;
      setLoading(true);
      setSession(next);
      await load(next?.user);
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
