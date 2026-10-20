import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getSession();
    const session = data.session;
    if (error || !session) {
      throw redirect({
        to: "/auth",
        search: { mode: "signin", role: undefined, email: "", name: "" },
      });
    }

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .limit(1)
      .maybeSingle();
    const metadataRole = session.user.user_metadata["role"];
    const role = roleRow?.role ?? (metadataRole === "tenant" ? "tenant" : "owner");
    const tenantOnly = location.pathname === "/cabinet";
    const adminOnly = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
    const ownerOnly = ["/dashboard", "/properties", "/tenants", "/agreements", "/finances"].some(
      (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
    );

    if (role === "tenant" && ownerOnly) throw redirect({ to: "/cabinet" });
    if (adminOnly && role !== "admin") {
      throw redirect({ to: role === "tenant" ? "/cabinet" : "/dashboard" });
    }
    if (role !== "tenant" && tenantOnly) throw redirect({ to: "/dashboard" });
    return { user: session.user, role };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
