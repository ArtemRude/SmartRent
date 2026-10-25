import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  LifeBuoy,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { billingPresentation } from "@/components/billing/billing-presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/auth-context";
import { BILLING_PLANS, getBillingAccess } from "@/lib/billing";
import { billingQueryOptions } from "@/lib/billing-queries";
import { formatMoney } from "@/lib/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Тариф и доступ — SmartRent" },
      { name: "description", content: "Тарифы SmartRent, условия подписки и сохранение доступа." },
    ],
  }),
  component: BillingPage,
});

function TenantBilling() {
  return (
    <Card className="border-primary/20 bg-primary/[0.025]">
      <CardContent className="p-6 sm:p-8">
        <ShieldCheck className="h-8 w-8 text-primary" />
        <h2 className="mt-4 text-xl font-semibold">Кабинет арендатора бесплатный</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Договоры, начисления, сообщения об оплате и заявки доступны без подписки SmartRent.
          Подписка собственника не ограничивает ваши действия по действующей аренде. Платежи по
          договору аренды учитываются отдельно от оплаты сервиса.
        </p>
        <Button asChild className="mt-6">
          <Link to="/cabinet">Перейти в кабинет</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function BillingPage() {
  const { user, role } = useAuth();
  const overview = useQuery({
    ...billingQueryOptions(user?.id),
    enabled: Boolean(user) && (role === "owner" || role === "admin"),
  });
  const status = overview.data && !overview.isError ? billingPresentation(overview.data) : null;
  const access = overview.data ? getBillingAccess(overview.data) : null;
  const plan = BILLING_PLANS.find((item) => item.id === access?.effectivePlan);
  const previousPlan = BILLING_PLANS.find((item) => item.id === overview.data?.plan);
  const early = status?.phase === "prelaunch" || status?.phase === "notice";
  const ready = Boolean(status && status.phase !== "unavailable" && overview.data?.available);
  const activePlan = ready && !early ? plan : null;

  return (
    <>
      <PageHeader
        title="Тариф и доступ"
        description={
          role === "tenant"
            ? "Условия доступа в кабинет арендатора"
            : "Возможности для вашего масштаба аренды"
        }
      />

      {role === "tenant" ? (
        <TenantBilling />
      ) : (
        <div className="space-y-8">
          {overview.isPending && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground" role="status">
                Загружаем условия доступа…
              </CardContent>
            </Card>
          )}
          {overview.isError && (
            <Card className="border-destructive/20">
              <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm" role="alert">
                  Не удалось загрузить подписку. Данные о текущем тарифе временно недоступны.
                </p>
                <Button variant="outline" onClick={() => void overview.refetch()}>
                  Повторить
                </Button>
              </CardContent>
            </Card>
          )}

          {status && (
            <Card
              className={cn(
                "overflow-hidden",
                status.tone === "positive" && "border-primary/20 bg-primary/[0.035]",
                status.tone === "warning" && "border-amber-300 bg-amber-50/50",
              )}
            >
              <CardContent className="p-6 sm:p-8">
                <div className="flex items-center gap-2 text-primary">
                  {early ? <Sparkles className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                  <Badge variant="outline" className="bg-background/80">
                    {status.label}
                  </Badge>
                </div>
                <h2 className="mt-4 text-xl font-semibold sm:text-2xl">{status.title}</h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {status.description}
                </p>
                {status.phase === "restricted" && previousPlan?.id !== "start" && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Предыдущий тариф: {previousPlan?.name}. Сейчас доступны базовые возможности
                    «Старта».
                  </p>
                )}
                {early && (
                  <p className="mt-4 text-sm font-medium text-primary">Сейчас к оплате: 0 ₽</p>
                )}
                {ready && overview.data && (
                  <div className="mt-6 grid gap-4 border-t border-primary/10 pt-6 sm:grid-cols-2">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Building2 className="h-4 w-4 text-muted-foreground" /> Единицы аренды
                      </p>
                      <p className="mt-2 text-2xl font-semibold">
                        {overview.data.units_used}
                        {activePlan && (
                          <span className="text-base font-normal text-muted-foreground">
                            {" "}
                            / {activePlan.units}
                          </span>
                        )}
                      </p>
                      {activePlan ? (
                        <Progress
                          className="mt-3 max-w-xs"
                          aria-label="Использованный лимит единиц аренды"
                          value={Math.min(100, (overview.data.units_used / activePlan.units) * 100)}
                        />
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Тарифный лимит пока не применяется
                        </p>
                      )}
                      {activePlan && overview.data.units_used > activePlan.units && (
                        <p className="mt-2 text-xs text-amber-800">
                          Лимит превышен. Существующие данные сохраняются.
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <Users className="h-4 w-4 text-muted-foreground" /> Участники команды
                      </p>
                      <p className="mt-2 text-2xl font-semibold">
                        {overview.data.seats_used}
                        {activePlan && (
                          <span className="text-base font-normal text-muted-foreground">
                            {" "}
                            / {activePlan.seats}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Без собственника. Ожидающие приглашения тоже занимают место.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <section aria-labelledby="billing-plans-title">
            <div className="mb-5">
              <h2 id="billing-plans-title" className="text-xl font-semibold">
                {early ? "Тарифы после запуска" : "Тарифы SmartRent"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {early
                  ? "Предварительные цены за месяц. Сейчас все возможности доступны бесплатно; выбор и оплата не требуются."
                  : "Месячная подписка собственника. Кабинет арендатора включён бесплатно."}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {BILLING_PLANS.map((item) => (
                <Card
                  key={item.id}
                  className={cn(
                    "flex flex-col",
                    activePlan?.id === item.id && "border-primary ring-1 ring-primary/20",
                  )}
                >
                  <CardHeader className="pb-4">
                    <div className="flex min-h-6 items-center justify-between gap-2">
                      <CardTitle className="text-lg">{item.name}</CardTitle>
                      {activePlan?.id === item.id && <Badge variant="secondary">Ваш тариф</Badge>}
                    </div>
                    <p className="min-h-10 text-sm leading-5 text-muted-foreground">
                      {item.description}
                    </p>
                    <p className="pt-3 text-3xl font-semibold tracking-tight">
                      {formatMoney(item.price)}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">/ мес.</span>
                    </p>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col">
                    <p className="text-sm font-semibold">До {item.units} ед. аренды</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.seats > 0
                        ? `До ${item.seats} участников + собственник`
                        : "Для одного собственника"}
                    </p>
                    <ul className="mb-6 mt-5 space-y-3">
                      {item.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm leading-5">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {early ? (
                      <p className="mt-auto rounded-lg bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
                        Условия после запуска
                      </p>
                    ) : (
                      <Button
                        asChild
                        variant={activePlan?.id === item.id ? "outline" : "default"}
                        className="mt-auto w-full"
                      >
                        <Link to="/support">
                          {activePlan?.id === item.id ? "Условия и продление" : "Обсудить тариф"}
                        </Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Единица аренды — отдельная сдаваемая площадь: квартира целиком или каждое помещение.
              Свободные площади в управлении тоже учитываются; история договоров и арендаторы лимит
              не занимают.
            </p>
          </section>

          <section aria-labelledby="billing-expiration-title">
            <div className="mb-5 flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-muted-foreground" />
              <h2 id="billing-expiration-title" className="text-xl font-semibold">
                Если подписка не продлена
              </h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardContent className="p-5">
                  <Badge variant="secondary">Первые 7 дней</Badge>
                  <h3 className="mt-4 font-semibold">Время на продление</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    После окончания оплаченного периода все возможности тарифа сохраняются ещё 7
                    дней. Автоматического списания нет.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <Badge variant="outline">После льготного периода</Badge>
                  <h3 className="mt-4 font-semibold">Пауза для новых действий</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Нельзя расширять лимиты и начинать новые процессы в платных модулях. Продление
                    возвращает доступ; данные не удаляются.
                  </p>
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="p-5">
                  <Badge variant="outline" className="gap-1.5">
                    <CheckCircle2 className="h-3 w-3" /> Доступ сохраняется
                  </Badge>
                  <h3 className="mt-4 font-semibold">Текущая аренда продолжается</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    История, платежи, заявки и действия по действующим обязательствам остаются
                    доступны. Кабинет арендатора всегда бесплатный.
                  </p>
                </CardContent>
              </Card>
            </div>
            {early && (
              <p className="mt-4 text-sm text-muted-foreground">
                Эти правила начнут действовать только после запуска платного доступа и завершения
                переходного периода.
              </p>
            )}
          </section>

          <Card className="shadow-none">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="font-medium">Поможем подобрать тариф</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Больше 50 единиц аренды, вопросы по условиям или продлению — напишите нам.
                  </p>
                </div>
              </div>
              <Button variant="outline" asChild className="shrink-0">
                <Link to="/support">
                  Написать в поддержку <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
