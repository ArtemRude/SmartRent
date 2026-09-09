import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Circle,
  CreditCard,
  FileText,
  Inbox,
  Clock3,
  Users,
  WalletCards,
} from "lucide-react";
import { AttentionCenter } from "@/components/AttentionCenter";
import { PageHeader } from "@/components/AppShell";
import { NotificationsPreview } from "@/components/NotificationsPreview";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  fetchAgreements,
  fetchProperties,
  fetchRentCharges,
  fetchRequests,
  fetchTenants,
} from "@/lib/queries";
import {
  calendarDaysBetween,
  formatDate,
  formatMoney,
  getPaymentStatus,
  localDateKey,
} from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Мой кабинет — Умная Аренда" },
      { name: "description", content: "Сводка по объектам, договорам и заявкам собственника." },
      { property: "og:title", content: "Мой кабинет — Умная Аренда" },
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
    <Card className={to ? "h-full transition-shadow hover:shadow-md" : "h-full"}>
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
  return to ? (
    <Link to={to} className="block h-full">
      {card}
    </Link>
  ) : (
    card
  );
}

function Dashboard() {
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const requests = useQuery({ queryKey: ["requests"], queryFn: fetchRequests });
  const charges = useQuery({ queryKey: ["rent-charges"], queryFn: fetchRentCharges });
  const queries = [properties, tenants, agreements, requests, charges];

  const openRequests = (requests.data ?? []).filter((r) => r.status !== "closed");
  const today = localDateKey();
  const expiring = (agreements.data ?? []).filter((a) => {
    const d = calendarDaysBetween(today, a.end_date);
    return a.status === "active" && d >= 0 && d <= 45;
  });
  const income = (agreements.data ?? [])
    .filter((a) => a.status === "active")
    .reduce((s, a) => s + Number(a.monthly_payment ?? 0), 0);
  const debt = (charges.data ?? [])
    .filter((charge) => getPaymentStatus(charge) === "overdue")
    .reduce((sum, charge) => sum + Number(charge.amount), 0);
  const receivedThisMonth = (charges.data ?? [])
    .filter((charge) => charge.paid_at?.startsWith(today.slice(0, 7)))
    .reduce((sum, charge) => sum + Number(charge.amount), 0);
  const overdueCharges = (charges.data ?? [])
    .filter((charge) => getPaymentStatus(charge) === "overdue")
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const upcomingCharges = (charges.data ?? [])
    .filter((charge) => {
      const days = calendarDaysBetween(today, charge.due_date);
      return charge.paid_at == null && days >= 0 && days <= 7;
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const onboardingSteps = [
    {
      title: "Добавьте объект",
      description: "Создайте карточку квартиры, склада или коммерческого помещения.",
      completed: (properties.data?.length ?? 0) > 0,
      to: "/properties" as const,
    },
    {
      title: "Добавьте арендатора",
      description: "Укажите контакты арендатора и подключите его кабинет.",
      completed: (tenants.data?.length ?? 0) > 0,
      to: "/tenants" as const,
    },
    {
      title: "Создайте договор",
      description: "Свяжите объект с арендатором и задайте ежемесячную плату.",
      completed: (agreements.data?.length ?? 0) > 0,
      to: "/agreements" as const,
    },
    {
      title: "Проверьте начисление",
      description: "Убедитесь, что первый арендный платёж появился в календаре.",
      completed: (charges.data?.length ?? 0) > 0,
      to: "/payments" as const,
    },
  ];
  const completedOnboardingSteps = onboardingSteps.filter((step) => step.completed).length;
  const nextOnboardingStep = onboardingSteps.find((step) => !step.completed);
  const onboardingLoaded = !queries.some((query) => query.isPending);
  const tenantName = (tenantId: string) =>
    tenants.data?.find((tenant) => tenant.id === tenantId)?.name ?? "Арендатор";
  const propertyName = (propertyId: string) =>
    properties.data?.find((property) => property.id === propertyId)?.name ?? "Объект";
  const attentionGroups = [
    {
      title: "Просроченные платежи",
      description: "Начисления с прошедшим сроком оплаты",
      count: overdueCharges.length,
      icon: AlertTriangle,
      to: "/payments" as const,
      tone: "danger" as const,
      items: overdueCharges.map((charge) => ({
        id: charge.id,
        title: tenantName(charge.tenant_id),
        meta: `${formatMoney(Number(charge.amount))} · ${formatDate(charge.due_date)}`,
      })),
    },
    {
      title: "Оплата в ближайшие 7 дней",
      description: "Платежи, которые скоро наступят",
      count: upcomingCharges.length,
      icon: Clock3,
      to: "/payments" as const,
      tone: "warning" as const,
      items: upcomingCharges.map((charge) => ({
        id: charge.id,
        title: tenantName(charge.tenant_id),
        meta: `${formatMoney(Number(charge.amount))} · ${formatDate(charge.due_date)}`,
      })),
    },
    {
      title: "Открытые заявки",
      description: "Новые обращения и заявки в работе",
      count: openRequests.length,
      icon: Inbox,
      to: "/requests" as const,
      tone: "primary" as const,
      items: openRequests.map((request) => ({
        id: request.id,
        title: request.title,
        meta: formatDate(request.created_at),
      })),
    },
    {
      title: "Договоры на исходе",
      description: "Окончание в ближайшие 45 дней",
      count: expiring.length,
      icon: CalendarClock,
      to: "/agreements" as const,
      tone: "default" as const,
      items: expiring.map((agreement) => ({
        id: agreement.id,
        title: propertyName(agreement.property_id),
        meta: `${calendarDaysBetween(today, agreement.end_date)} дн.`,
      })),
    },
  ];

  return (
    <>
      <PageHeader title="Мой кабинет" description="Общая картина по вашей недвижимости" />

      {queries.some((query) => query.isPending) && (
        <p className="mb-4 text-sm text-muted-foreground">Загружаем сводку…</p>
      )}
      {queries.some((query) => query.isError) && (
        <p className="mb-4 text-sm text-destructive">
          Часть данных не загрузилась. Обновите страницу или попробуйте позже.
        </p>
      )}

      {onboardingLoaded && <AttentionCenter groups={attentionGroups} />}

      {onboardingLoaded && nextOnboardingStep && (
        <Card className="mb-6 overflow-hidden border-primary/20 bg-primary/[0.025]">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg">Быстрый старт</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Настройте управление арендой за четыре шага
                </p>
              </div>
              <div className="min-w-40">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Готово</span>
                  <span>
                    {completedOnboardingSteps} из {onboardingSteps.length}
                  </span>
                </div>
                <Progress value={(completedOnboardingSteps / onboardingSteps.length) * 100} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {onboardingSteps.map((step) => (
                <div key={step.title} className="flex gap-3 rounded-xl border bg-background/80 p-3">
                  {step.completed ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" />
                  )}
                  <div className="min-w-0">
                    <p
                      className={
                        step.completed
                          ? "text-sm font-medium text-muted-foreground"
                          : "text-sm font-medium"
                      }
                    >
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button asChild>
                <Link to={nextOnboardingStep.to}>
                  {nextOnboardingStep.title} <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
        <Stat icon={Inbox} label="Открытые заявки" value={openRequests.length} to="/requests" />
        <Stat icon={CreditCard} label="Задолженность" value={formatMoney(debt)} to="/payments" />
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
              <WalletCards className="h-4 w-4" /> Получено в этом месяце
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{formatMoney(receivedThisMonth)}</p>
            <p className="mt-1 text-sm text-muted-foreground">По отмеченным оплатам</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Последние заявки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(requests.data ?? []).slice(0, 5).map((r) => (
            <Link
              key={r.id}
              to="/requests"
              className="flex items-center justify-between gap-3 rounded-lg p-1 transition-colors hover:bg-muted/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(r.created_at)}</p>
              </div>
              <StatusBadge status={r.status} />
            </Link>
          ))}
          {(requests.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Заявок пока нет.</p>
          )}
        </CardContent>
      </Card>

      <NotificationsPreview className="mt-6" />
    </>
  );
}
