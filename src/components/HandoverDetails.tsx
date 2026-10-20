import { CheckCircle2, Circle } from "lucide-react";
import { HandoverPhoto } from "@/components/HandoverPhoto";
import { readAgreementContractDetails } from "@/lib/agreement-document";
import { formatDate, formatDateTime } from "@/lib/domain";
import { handoverChecks, type LeaseHandover } from "@/lib/handovers";
import { handoverMoney } from "@/lib/handover-report";
import { HANDOVER_PHOTOS } from "@/lib/storage";

export function HandoverDetails({ report }: { report: LeaseHandover }) {
  const inventory =
    readAgreementContractDetails({ inventoryItems: report.inventory_snapshot }).inventoryItems ??
    [];
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        Осмотр {formatDate(report.inspection_date)} · Ключей: {report.keys_count} · Версия{" "}
        {report.revision}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {Object.entries(handoverChecks).map(([key, title]) => (
          <li key={key} className="flex gap-2">
            {report.checklist[key as keyof typeof handoverChecks] ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            {title}
          </li>
        ))}
      </ul>
      <div>
        <h3 className="font-medium">Состояние помещения и имущества</h3>
        <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
          {report.condition_note || "Не описано"}
        </p>
      </div>
      {inventory.length > 0 && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            Опись на момент сохранения · {inventory.length}
          </summary>
          <ul className="mt-2 space-y-2">
            {inventory.map((item, i) => (
              <li key={i} className="break-words">
                {item.name} · {item.quantity} · {item.condition}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div>
        <h3 className="font-medium">Показания счётчиков</h3>
        <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
          {report.meter_readings || "Не указаны"}
        </p>
      </div>
      {report.photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {report.photos.map((path, i) => (
            <HandoverPhoto
              key={path}
              bucket={HANDOVER_PHOTOS}
              path={path}
              label={`Фото осмотра ${i + 1}`}
            />
          ))}
        </div>
      )}
      <div className="rounded-xl border bg-muted/20 p-4" data-testid="handover-deposit-summary">
        <h3 className="font-medium">Расчёт депозита</h3>
        <dl className="mt-3 space-y-2">
          <div className="flex flex-wrap justify-between gap-2">
            <dt>Получено собственником</dt>
            <dd className="font-medium">{handoverMoney(Number(report.deposit_received))}</dd>
          </div>
          {report.kind === "move_out" && (
            <>
              <div className="flex flex-wrap justify-between gap-2">
                <dt>Удержания</dt>
                <dd>{handoverMoney(Number(report.deductions_total))}</dd>
              </div>
              {report.deductions.map((item, i) => (
                <div
                  key={i}
                  className="flex flex-wrap justify-between gap-2 border-l pl-3 text-muted-foreground"
                >
                  <dt className="min-w-0 break-words">{item.reason}</dt>
                  <dd className="shrink-0">{handoverMoney(Number(item.amount))}</dd>
                </div>
              ))}
              <div className="flex flex-wrap justify-between gap-2 border-t pt-2 text-base font-semibold">
                <dt>К возврату</dt>
                <dd>{handoverMoney(Number(report.refund_due))}</dd>
              </div>
            </>
          )}
        </dl>
        {report.kind === "move_out" && (
          <p className="mt-3 text-xs text-muted-foreground">
            {report.refund_confirmed_at
              ? `Получение подтверждено арендатором ${formatDateTime(report.refund_confirmed_at)}`
              : report.refund_marked_at
                ? `Возврат отмечен собственником ${formatDateTime(report.refund_marked_at)}. Ожидается подтверждение получения.`
                : Number(report.refund_due) > 0
                  ? "Возврат ещё не отмечен. Расчёт не выполняет перевод денег."
                  : "По расчёту возврат не требуется."}
          </p>
        )}
      </div>
      {report.review_note && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <p className="font-medium">Замечания арендатора</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{report.review_note}</p>
        </div>
      )}
    </div>
  );
}
