import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TEAM_INVITE_STORAGE_KEY } from "@/lib/team";
import { hasPendingTeamInvitation, invitationTokenFromHash } from "@/lib/team-invitation";

export const Route = createFileRoute("/join-team")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Приглашение в команду — SmartRent" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: JoinTeamPage,
});

function JoinTeamPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Проверяем ссылку приглашения…");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = invitationTokenFromHash(window.location.hash);
        // Capture before authentication: fragments are never sent to the web server.
        if (token) sessionStorage.setItem(TEAM_INVITE_STORAGE_KEY, token);
        window.history.replaceState(window.history.state, "", window.location.pathname);
        if (!hasPendingTeamInvitation()) {
          if (active)
            setMessage("Откройте полную ссылку приглашения, которую передал собственник.");
          return;
        }
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active) return;
        if (data.session) await navigate({ to: "/team", replace: true });
        else
          await navigate({
            to: "/auth",
            search: { mode: "signin", role: undefined, email: "", name: "" },
            replace: true,
          });
      } catch {
        if (active)
          setMessage(
            "Не удалось сохранить приглашение. Разрешите хранение данных для сайта и откройте ссылку повторно.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate]);
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardContent className="space-y-4 p-6">
          <h1 className="text-2xl font-semibold">Приглашение в команду</h1>
          <p role="status" className="text-muted-foreground">
            {message}
          </p>
          <Button asChild variant="outline">
            <Link to="/team">Открыть команду</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
