import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, CalendarClock, FileText, Inbox, Users } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAgreements, fetchProperties, fetchRequests, fetchTenants } from "@/lib/queries";
import { daysUntil, formatDate, formatMoney } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Дашборд — Умная Аренда" },
      { name: "description", content: "Сводка по объектам, договорам и заявкам собственника." },
      { property: "og:title", content: "Дашборд — Умная Аренда" },
      { property: "og:description", content: "Сводка по объектам, договорам и заявкам." },
    ],
  }),
  component: Dashboard,
});

function Stat({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  to?: string;
}) {
  const card = (
    <Card className={to ? "transition-shadow hover:shadow-md" : undefined}>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{card}</Link> : card;
}

function Dashboard() {
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const requests = useQuery({ queryKey: ["requests"], queryFn: fetchRequests });
  const queries = [properties, tenants, agreements, requests];

  const openRequests = (requests.data ?? []).filter((r) => r.status !== "closed");
  const expiring = (agreements.data ?? []).filter((a) => {
    const d = daysUntil(a.end_date);
    return a.status === "active" && d >= 0 && d <= 45;
  });
  const income = (agreements.data ?? [])
    .filter((a) => a.status === "active")
    .reduce((s, a) => s + Number(a.monthly_payment ?? 0), 0);

  return (
    <>
      <PageHeader title="Дашборд" description="Общая картина по вашей недвижимости" />

      {queries.some((query) => query.isPending) && (
        <p className="mb-4 text-sm text-muted-foreground">Загружаем сводку…</p>
      )}
      {queries.some((query) => query.isError) && (
        <p className="mb-4 text-sm text-destructive">
          Часть данных не загрузилась. Обновите страницу или попробуйте позже.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Building2}
          label="Объекты"
          value={properties.data?.length ?? 0}
          to="/properties"
        />
        <Stat icon={Users} label="Арендаторы" value={tenants.data?.length ?? 0} to="/tenants" />
        <Stat
          icon={FileText}
          label="Договоры"
          value={agreements.data?.length ?? 0}
          to="/agreements"
        />
        <Stat icon={Inbox} label="Открытые заявки" value={openRequests.length} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ожидаемый доход в месяц</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{formatMoney(income)}</p>
            <p className="mt-1 text-sm text-muted-foreground">По активным договорам</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" /> Договоры на исходе
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {expiring.length === 0 && (
              <p className="text-sm text-muted-foreground">Ближайшие 45 дней — без окончаний.</p>
            )}
            {expiring.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">
                  {properties.data?.find((p) => p.id === a.property_id)?.name ?? "Объект"}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  до {formatDate(a.end_date)} · {daysUntil(a.end_date)} дн.
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Последние заявки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(requests.data ?? []).slice(0, 5).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(r.created_at)}</p>
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
          {(requests.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Заявок пока нет.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
