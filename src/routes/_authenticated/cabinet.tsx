import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, FileText, Inbox } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { fetchMyTenantRecords } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/cabinet")({
  head: () => ({ meta: [{ title: "Мой кабинет — Умная Аренда" }] }),
  component: CabinetPage,
});

function CabinetPage() {
  const { user } = useAuth();
  const tenants = useQuery({
    queryKey: ["my-tenant-records", user?.id],
    queryFn: () => fetchMyTenantRecords(user!.id),
    enabled: Boolean(user),
  });

  return (
    <>
      <PageHeader title="Мой кабинет" description="Данные вашей аренды в одном месте" />
      {tenants.isPending && <p className="text-sm text-muted-foreground">Загружаем кабинет…</p>}
      {tenants.isError && (
        <p className="text-sm text-destructive">Не удалось загрузить данные кабинета.</p>
      )}
      {!tenants.isPending && !tenants.isError && (tenants.data?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Аренда пока не подключена</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Попросите собственника добавить вас с email, использованным при регистрации.
            </p>
          </CardContent>
        </Card>
      )}
      {(tenants.data?.length ?? 0) > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Договоры
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Раздел появится на следующем этапе.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox className="h-4 w-4" /> Заявки
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Раздел появится на следующем этапе.
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
