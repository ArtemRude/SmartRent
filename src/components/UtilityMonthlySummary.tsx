import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMonth } from "@/lib/domain";
import { formatUtilityMoney } from "@/lib/utilities";
import type { buildUtilityMonthlySummary } from "@/lib/utility-summary";

export function UtilityMonthlySummary({
  period,
  summary,
}: {
  period: string;
  summary: ReturnType<typeof buildUtilityMonthlySummary>;
}) {
  const label = {
    approved: "Начислено",
    pending: "Коммунальные на проверке",
    estimate: "Предварительный итог",
    missing: "Коммунальные ещё не рассчитаны",
  }[summary.state];
  return (
    <Card data-testid="utility-monthly-summary" className="border-primary/20 bg-accent/30">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            Аренда и коммунальные ·{" "}
            <span className="capitalize">{formatMonth(`${period}-01`)}</span>
          </h2>
          <Badge variant="secondary">{label}</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Аренда за месяц</p>
            <p className="mt-1 text-lg font-semibold">
              {summary.rentTotal !== null
                ? formatUtilityMoney(summary.rentTotal)
                : "Ещё не начислена"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Коммунальные услуги</p>
            <p className="mt-1 text-lg font-semibold">
              {summary.utilityTotal !== null
                ? formatUtilityMoney(summary.utilityTotal)
                : "Ожидаются показания"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              {summary.state === "approved"
                ? "Всего начислено за месяц"
                : "Итого после утверждения"}
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {summary.total !== null ? formatUtilityMoney(summary.total) : "—"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-primary/10 pt-3 text-sm">
          <p>
            Уже оплачено:{" "}
            <strong>
              {summary.paid !== null ? formatUtilityMoney(summary.paid) : "Уточняется"}
            </strong>
          </p>
          <p>
            Остаток по выставленным начислениям:{" "}
            <strong>
              {summary.remaining !== null ? formatUtilityMoney(summary.remaining) : "Уточняется"}
            </strong>
          </p>
        </div>
        {(summary.state === "pending" || summary.state === "estimate") && (
          <p className="text-xs text-muted-foreground">
            Коммунальные услуги добавятся к сумме для оплаты после утверждения собственником. Уже
            внесённые платежи учитываются в остатке.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
