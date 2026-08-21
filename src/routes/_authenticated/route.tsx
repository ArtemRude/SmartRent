import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { mode: "signin" } });
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .limit(1)
      .maybeSingle();
    const role = roleRow?.role ?? "owner";
    const tenantOnly = location.pathname === "/cabinet";
    const ownerOnly = ["/dashboard", "/properties", "/tenants"].some(
      (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
    );

    if (role === "tenant" && ownerOnly) throw redirect({ to: "/cabinet" });
    if (role !== "tenant" && tenantOnly) throw redirect({ to: "/dashboard" });
    return { user: data.user, role };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
