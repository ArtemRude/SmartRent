import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/domain";

export type Profile = { id: string; name: string; email: string; phone: string | null };

type AuthValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthValue>({
  session: null,
  user: null,
  profile: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
