import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, roleLabels, type AppRole } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Администрирование — Умная Аренда" },
      { name: "description", content: "Управление пользователями и ролями платформы." },
    ],
  }),
  component: AdminPage,
});

type AdminUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  created_at: string;
  role: AppRole;
};

const editableRoles: AppRole[] = ["owner", "tenant", "admin"];

async function fetchAdminUsers(): Promise<AdminUser[]> {
  const [profilesResult, rolesResult] = await Promise.all([
    supabase.from("profiles").select("id,name,email,phone,created_at").order("created_at"),
    supabase.from("user_roles").select("user_id,role"),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (rolesResult.error) throw new Error(rolesResult.error.message);

  const roles = new Map(rolesResult.data.map((item) => [item.user_id, item.role as AppRole]));
  return profilesResult.data
    .map((profile) => ({ ...profile, role: roles.get(profile.id) }))
    .filter((profile): profile is AdminUser => Boolean(profile.role));
}

function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pendingRole, setPendingRole] = useState<{
    target: AdminUser;
    role: AppRole;
  } | null>(null);

  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: fetchAdminUsers });
  const users = usersQuery.data ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = normalizedSearch
    ? users.filter(
        (item) =>
          item.name.toLowerCase().includes(normalizedSearch) ||
          item.email.toLowerCase().includes(normalizedSearch),
      )
    : users;

  const updateRole = useMutation({
    mutationFn: async ({ target, role }: { target: AdminUser; role: AppRole }) => {
      const { data, error } = await supabase
        .from("user_roles")
        .update({ role })
        .eq("user_id", target.id)
        .select("user_id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Роль не была изменена. Проверьте права администратора.");
    },
    onSuccess: (_, variables) => {
      toast.success(`Для ${variables.target.name} назначена роль «${roleLabels[variables.role]}»`);
      setPendingRole(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const roleCount = (role: AppRole) => users.filter((item) => item.role === role).length;

  return (
    <>
      <PageHeader
        title="Администрирование"
        description="Пользователи платформы и их уровень доступа"
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Всего пользователей", value: users.length, icon: Users },
          { label: "Собственники", value: roleCount("owner"), icon: UserRound },
          { label: "Арендаторы", value: roleCount("tenant"), icon: UserRound },
          { label: "Администраторы", value: roleCount("admin"), icon: ShieldCheck },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                <item.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-2xl font-semibold">{item.value}</p>
                <p className="text-xs text-muted-foreground">{item.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по имени или email"
          className="pl-9"
        />
      </div>

      {usersQuery.isPending && (
        <p className="text-sm text-muted-foreground">Загружаем пользователей…</p>
      )}
      {usersQuery.isError && (
        <p className="text-sm text-destructive">Не удалось загрузить пользователей.</p>
      )}

      <div className="space-y-3">
        {filteredUsers.map((item) => {
          const isCurrentUser = item.id === user?.id;
          return (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
                  {item.role === "admin" ? (
                    <ShieldCheck className="h-5 w-5" />
                  ) : (
                    <UserRound className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{item.name || "Без имени"}</h2>
                    {isCurrentUser && (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                        Вы
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{item.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Зарегистрирован {formatDate(item.created_at)}
                  </p>
                </div>
                <Select
                  value={item.role}
                  disabled={isCurrentUser || updateRole.isPending}
                  onValueChange={(role) => setPendingRole({ target: item, role: role as AppRole })}
                >
                  <SelectTrigger className="w-full md:w-48" aria-label={`Роль ${item.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {editableRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {roleLabels[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!usersQuery.isPending && filteredUsers.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Пользователи не найдены.
          </CardContent>
        </Card>
      )}

      <AlertDialog open={Boolean(pendingRole)} onOpenChange={() => setPendingRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Изменить роль пользователя?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRole
                ? `${pendingRole.target.name} получит роль «${roleLabels[pendingRole.role]}» и соответствующий доступ к разделам.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingRole || updateRole.isPending}
              onClick={() => pendingRole && updateRole.mutate(pendingRole)}
            >
              Изменить роль
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
