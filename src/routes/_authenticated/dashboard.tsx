import { rentAt } from "@/lib/lease-changes";
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
  fetchAgreementAcceptances,
  fetchProperties,
  fetchRentCharges,
  fetchRentPayments,
  fetchRequests,
  fetchTenants,
} from "@/lib/queries";
import {
  calendarDaysBetween,
  formatDate,
  formatMoney,
  getPaymentStatus,
  getRentChargeBalance,
  getRentChargeTotal,
  localDateKey,
} from "@/lib/domain";
import { sumPaymentsForMonth } from "@/lib/payment-analytics";
import { buildRentalOnboarding } from "@/lib/rental-onboarding";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Мой кабинет — SmartRent" },
      { name: "description", content: "Сводка по объектам, договорам и заявкам собственника." },
      { property: "og:title", content: "Мой кабинет — SmartRent" },
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
  loading = false,
  error = false,
}: {
  icon: typeof Building2;
  label: string;
  value: string | number;
  to?: string;
  loading?: boolean;
  error?: boolean;
}) {
  const card = (
    <Card className={to ? "h-full transition-shadow hover:shadow-md" : "h-full"}>
      <CardContent className="flex items-center gap-4 p-5">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p
            className={
              loading || error
                ? "text-sm font-medium text-muted-foreground"
                : "text-2xl font-semibold"
            }
          >
            {error ? "Недоступно" : loading ? "Загрузка…" : value}
          </p>
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
  const acceptances = useQuery({
    queryKey: ["agreement-acceptances"],
    queryFn: fetchAgreementAcceptances,
  });
  const requests = useQuery({ queryKey: ["requests"], queryFn: fetchRequests });
  const charges = useQuery({ queryKey: ["rent-charges"], queryFn: fetchRentCharges });
  const payments = useQuery({ queryKey: ["rent-payments"], queryFn: fetchRentPayments });
  const queries = [properties, tenants, agreements, acceptances, requests, charges, payments];

  const openRequests = (requests.data ?? []).filter((r) => r.status !== "closed");
  const today = localDateKey();
  const expiring = (agreements.data ?? []).filter((a) => {
    const d = calendarDaysBetween(today, a.end_date);
    return a.status === "active" && d >= 0 && d <= 45;
  });
  const income = (agreements.data ?? [])
    .filter((a) => a.status === "active")
    .reduce((s, a) => s + rentAt(a, today), 0);
  const debt = (charges.data ?? [])
    .filter((charge) => charge.paid_at == null && charge.due_date < today)
    .reduce((sum, charge) => sum + getRentChargeBalance(charge), 0);
  // A missing legacy history API may use valid charge data, but an API error
  // must never masquerade as a complete sum of received payments.
  const receivedSources = payments.data?.available === false ? [payments, charges] : [payments];
  const receivedReady = receivedSources.every((query) => query.isSuccess);
  const receivedFailed = receivedSources.some((query) => query.isError);
  const receivedThisMonth = payments.data?.available
    ? sumPaymentsForMonth(payments.data.payments, today.slice(0, 7))
    : (charges.data ?? [])
        .filter((charge) => charge.paid_at?.startsWith(today.slice(0, 7)))
        .reduce((sum, charge) => sum + getRentChargeTotal(charge), 0);
  const overdueCharges = (charges.data ?? [])
    .filter((charge) => charge.paid_at == null && charge.due_date < today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const upcomingCharges = (charges.data ?? [])
    .filter((charge) => {
      const days = calendarDaysBetween(today, charge.due_date);
      return charge.paid_at == null && days >= 0 && days <= 7;
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const onboardingSteps = buildRentalOnboarding({
    properties: properties.data ?? [],
    tenants: tenants.data ?? [],
    agreements: agreements.data ?? [],
    acceptances: acceptances.data ?? [],
    charges: charges.data ?? [],
  });
  const completedOnboardingSteps = onboardingSteps.filter((step) => step.completed).length;
  const nextOnboardingStep = onboardingSteps.find((step) => !step.completed);
  const attentionReady = [properties, tenants, agreements, requests, charges].every(
    (query) => query.isSuccess,
  );
  const onboardingReady = [properties, tenants, agreements, acceptances, charges].every(
    (query) => query.isSuccess,
  );
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
        meta: `${formatMoney(getRentChargeTotal(charge))} · ${formatDate(charge.due_date)}`,
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
        meta: `${formatMoney(getRentChargeTotal(charge))} · ${formatDate(charge.due_date)}`,
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

      {attentionReady && <AttentionCenter groups={attentionGroups} />}

      {onboardingReady && nextOnboardingStep && (
        <Card
          data-testid="rental-onboarding"
          className="mb-6 overflow-hidden border-primary/20 bg-primary/[0.025]"
        >
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg">Быстрый старт</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  От первого объекта до активного договора и начисления
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
                <Link to={nextOnboardingStep.to} search={nextOnboardingStep.search}>
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
          loading={properties.isPending}
          error={properties.isError}
          to="/properties"
        />
        <Stat
          icon={Users}
          label="Арендаторы"
          value={tenants.data?.length ?? 0}
          loading={tenants.isPending}
          error={tenants.isError}
          to="/tenants"
        />
        <Stat
          icon={FileText}
          label="Договоры"
          value={agreements.data?.length ?? 0}
          loading={agreements.isPending}
          error={agreements.isError}
          to="/agreements"
        />
        <Stat
          icon={Inbox}
          label="Открытые заявки"
          value={openRequests.length}
          loading={requests.isPending}
          error={requests.isError}
          to="/requests"
        />
        <Stat
          icon={CreditCard}
          label="Задолженность"
          value={formatMoney(debt)}
          loading={charges.isPending}
          error={charges.isError}
          to="/payments"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ожидаемый доход в месяц</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={
                agreements.isSuccess
                  ? "text-3xl font-semibold"
                  : "text-base font-medium text-muted-foreground"
              }
            >
              {agreements.isError
                ? "Недоступно"
                : agreements.isPending
                  ? "Загрузка…"
                  : formatMoney(income)}
            </p>
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
            <p
              className={
                receivedReady
                  ? "text-3xl font-semibold"
                  : "text-base font-medium text-muted-foreground"
              }
            >
              {receivedFailed
                ? "Недоступно"
                : !receivedReady
                  ? "Загрузка…"
                  : formatMoney(receivedThisMonth)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">По отмеченным оплатам</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Последние заявки</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {requests.isSuccess &&
            (requests.data ?? []).slice(0, 5).map((r) => (
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
          {requests.isPending && <p className="text-sm text-muted-foreground">Загружаем заявки…</p>}
          {requests.isError && (
            <p className="text-sm text-muted-foreground">Заявки временно недоступны.</p>
          )}
          {requests.isSuccess && (requests.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Заявок пока нет.</p>
          )}
        </CardContent>
      </Card>

      <NotificationsPreview className="mt-6" />
    </>
  );
}
