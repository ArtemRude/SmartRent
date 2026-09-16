import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, BellRing, CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatMoney } from "@/lib/domain";
import type { DebtGroup } from "@/lib/debt-center";

export function DebtCenter({
  groups,
  onPay,
  onRemind,
  onRemindAll,
  remindingAgreementId,
  remindingAll,
}: {
  groups: DebtGroup[];
  onPay: (chargeIds: string[]) => void;
  onRemind: (agreementId: string) => void;
  onRemindAll: (agreementIds: string[]) => void;
  remindingAgreementId?: string | null;
  remindingAll?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleGroups = expanded ? groups : groups.slice(0, 4);
  const totalDebt = groups.reduce((sum, group) => sum + group.total, 0);

  if (groups.length === 0) return null;

  return (
    <Card className="mt-4 border-destructive/20">
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Центр задолженности</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Просрочено {formatMoney(totalDebt)} по {groups.length} договорам
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {groups.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={remindingAll || Boolean(remindingAgreementId)}
                onClick={() => onRemindAll(groups.map((group) => group.agreementId))}
              >
                {remindingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BellRing className="h-4 w-4" />
                )}
                Напомнить всем
              </Button>
            )}
            <span className="rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive">
              Требует внимания
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {visibleGroups.map((group) => (
            <div key={group.agreementId} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{group.tenantName}</p>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {group.propertyName}
                  </p>
                </div>
                <p className="shrink-0 text-lg font-semibold text-destructive">
                  {formatMoney(group.total)}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {group.daysOverdue} дн. с {formatDate(group.oldestDueDate)}
                </span>
                <span>Просрочено платежей: {group.overdueCount}</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onPay(group.chargeIds)}>
                  Отметить оплату
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={remindingAll || Boolean(remindingAgreementId)}
                  onClick={() => onRemind(group.agreementId)}
                >
                  {remindingAgreementId === group.agreementId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BellRing className="h-4 w-4" />
                  )}
                  Напомнить
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/agreements" search={{ agreementId: group.agreementId }}>
                    Открыть договор
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>

        {groups.length > 4 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Свернуть" : `Показать все (${groups.length})`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
