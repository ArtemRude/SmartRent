import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход и регистрация — Умная Аренда" },
      {
        name: "description",
        content: "Войдите в «Умную Аренду» или создайте аккаунт собственника либо арендатора.",
      },
      { property: "og:title", content: "Вход и регистрация — Умная Аренда" },
      { property: "og:description", content: "Кабинет собственника и арендатора «Умная Аренда»." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search["mode"] === "signup" ? ("signup" as const) : ("signin" as const),
    role: search["role"] === "tenant" ? ("tenant" as const) : undefined,
    email: typeof search["email"] === "string" ? search["email"].slice(0, 254) : "",
    name: typeof search["name"] === "string" ? search["name"].slice(0, 120) : "",
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode, role: invitedRole, email: invitedEmail, name: invitedName } = Route.useSearch();
  const navigate = useNavigate();
  const { session, role, loading } = useAuth();
  const isTenantInvite = invitedRole === "tenant";
  const [tab, setTab] = useState<"signin" | "signup">(mode);
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState("");
  const [name, setName] = useState(invitedName);
  const [phone, setPhone] = useState("");
  const [accountRole, setAccountRole] = useState<"owner" | "tenant">("owner");
  const [busy, setBusy] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  useEffect(() => {
    setTab(mode);
    if (isTenantInvite) {
      setEmail(invitedEmail);
      setName(invitedName);
      setAccountRole("tenant");
    }
  }, [mode, isTenantInvite, invitedEmail, invitedName]);

  useEffect(() => {
    if (!loading && session && role) {
      navigate({
        to: role === "tenant" ? "/cabinet" : role === "admin" ? "/admin" : "/dashboard",
        replace: true,
      });
    }
  }, [loading, session, role, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (tab === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { name, phone, role: accountRole },
          },
        });
        if (error) throw error;
        if (!data.session) {
          setConfirmationRequired(true);
          toast.success("Письмо для подтверждения отправлено");
          return;
        }
        toast.success("Аккаунт создан");
        // AuthProvider receives SIGNED_IN, loads the profile and role, and only
        // then redirects. Navigating here races the protected route guard.
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("С возвращением!");
        const { data: roleRow } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id)
          .limit(1)
          .maybeSingle();
        const metadataRole = data.user.user_metadata["role"];
        const resolvedRole = roleRow?.role ?? (metadataRole === "tenant" ? "tenant" : "owner");
        await navigate({
          to:
            resolvedRole === "tenant"
              ? "/cabinet"
              : resolvedRole === "admin"
                ? "/admin"
                : "/dashboard",
          replace: true,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось выполнить вход";
      if (message.toLowerCase().includes("email not confirmed")) {
        setConfirmationRequired(true);
        toast.error("Сначала подтвердите email по ссылке из письма");
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth?mode=signin` },
      });
      if (error) throw error;
      toast.success("Новое письмо отправлено");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отправить письмо");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Умная Аренда</span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Вход</TabsTrigger>
              <TabsTrigger value="signup">Регистрация</TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {isTenantInvite && tab === "signup" && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                <p className="font-medium">Вас пригласили как арендатора</p>
                <p className="mt-1 text-muted-foreground">
                  Зарегистрируйтесь с указанным email — договор автоматически появится в вашем
                  кабинете.
                </p>
              </div>
            )}
            {confirmationRequired && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
                <p className="font-medium">Подтвердите email</p>
                <p className="mt-1 text-muted-foreground">
                  Откройте письмо от «Умной Аренды» и перейдите по ссылке. После этого вернитесь
                  сюда и войдите в аккаунт.
                </p>
                <Button
                  type="button"
                  variant="link"
                  className="mt-2 h-auto p-0"
                  onClick={() => void resendConfirmation()}
                  disabled={busy || !email}
                >
                  Отправить письмо ещё раз
                </Button>
              </div>
            )}
            {tab === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Имя</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Иван Петров"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Телефон</Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 900 000-00-00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role">Я —</Label>
                  <Select
                    value={accountRole}
                    onValueChange={(v) => setAccountRole(v as "owner" | "tenant")}
                    disabled={isTenantInvite}
                  >
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">Собственник</SelectItem>
                      <SelectItem value="tenant">Арендатор</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                readOnly={isTenantInvite && tab === "signup"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tab === "signup" ? "Создать аккаунт" : "Войти"}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Арендатор получает доступ к своему кабинету, если собственник добавил его с тем же
            email.
          </p>
        </div>
      </div>
    </div>
  );
}
