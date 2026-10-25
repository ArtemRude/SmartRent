import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { billingPresentation } from "@/components/billing/billing-presentation";
import { useAuth } from "@/hooks/auth-context";
import { BILLING_PLANS, getBillingAccess } from "@/lib/billing";
import { billingQueryOptions } from "@/lib/billing-queries";

export function BillingSummaryCard() {
  const { user, role } = useAuth();
  const overview = useQuery({
    ...billingQueryOptions(user?.id),
    enabled: Boolean(user) && (role === "owner" || role === "admin"),
  });

  if (role === "tenant") return null;

  const status = overview.data && !overview.isError ? billingPresentation(overview.data) : null;
  const isEarly = status?.phase === "prelaunch" || status?.phase === "notice";
  const access = overview.data ? getBillingAccess(overview.data) : null;
  const plan = BILLING_PLANS.find((item) => item.id === access?.effectivePlan);
  const Icon = isEarly ? Sparkles : WalletCards;
  const title = overview.isPending
    ? "Загружаем условия доступа…"
    : overview.isError || !status
      ? "Не удалось получить статус тарифа"
      : isEarly || status.phase === "unavailable"
        ? status.title
        : `${plan?.name ?? "Ваш тариф"} · ${status.label.toLowerCase()}`;

  return (
    <Card className="mb-6 border-primary/20 bg-primary/[0.025]" data-testid="billing-summary">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{title}</p>
              {status?.phase === "prelaunch" && <Badge variant="secondary">0 ₽ сейчас</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {overview.isError || !status
                ? "Тарифы и правила доступа — в разделе подписки."
                : status.phase === "prelaunch"
                  ? "Ограничения не действуют. О платном запуске предупредим заранее."
                  : status.description}
            </p>
          </div>
        </div>
        <Button variant="outline" asChild className="shrink-0">
          <Link to="/billing">
            Тариф и доступ <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
