import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarDays, FileText, Inbox, MapPin } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { formatDate, formatMoney } from "@/lib/domain";
import { fetchAgreements, fetchMyTenantRecords, fetchProperties, fetchUnits } from "@/lib/queries";

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
  const agreements = useQuery({
    queryKey: ["agreements", "tenant", user?.id],
    queryFn: fetchAgreements,
    enabled: Boolean(user),
  });
  const properties = useQuery({
    queryKey: ["properties", "tenant", user?.id],
    queryFn: fetchProperties,
    enabled: Boolean(user),
  });
  const units = useQuery({
    queryKey: ["units", "tenant", user?.id],
    queryFn: fetchUnits,
    enabled: Boolean(user),
  });
  const queries = [tenants, agreements, properties, units];
  const loading = queries.some((query) => query.isPending);
  const failed = queries.some((query) => query.isError);

  return (
    <>
      <PageHeader title="Мой кабинет" description="Данные вашей аренды в одном месте" />
      {loading && <p className="text-sm text-muted-foreground">Загружаем кабинет…</p>}
      {failed && <p className="text-sm text-destructive">Не удалось загрузить данные кабинета.</p>}
      {!loading && !failed && (tenants.data?.length ?? 0) === 0 && (
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
      {!loading && !failed && (tenants.data?.length ?? 0) > 0 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Договоры
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(agreements.data ?? []).map((agreement) => {
                const property = properties.data?.find((item) => item.id === agreement.property_id);
                const unit = units.data?.find((item) => item.id === agreement.unit_id);
                return (
                  <div key={agreement.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{property?.name ?? "Объект аренды"}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          {property?.address || "Адрес не указан"}
                          {unit ? ` · ${unit.name}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-xs text-success">
                        {agreement.status === "active" ? "Активен" : "Архив"}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                      <p className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        {formatDate(agreement.start_date)} — {formatDate(agreement.end_date)}
                      </p>
                      <p className="font-medium sm:text-right">
                        {formatMoney(agreement.monthly_payment)}/мес.
                      </p>
                    </div>
                  </div>
                );
              })}
              {(agreements.data?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">
                  Профиль подключён, но собственник ещё не добавил договор.
                </p>
              )}
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
