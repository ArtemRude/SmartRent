import { Clock3 } from "lucide-react";
import { agreementStatusLabels, formatDateTime } from "@/lib/domain";
import type { AgreementStatusEvent } from "@/lib/queries";

type AgreementStatusHistoryProps = {
  agreementId: string;
  ownerId: string;
  currentUserId?: string | undefined;
  events: AgreementStatusEvent[];
  isPending?: boolean;
  isError?: boolean;
};

export function AgreementStatusHistory({
  agreementId,
  ownerId,
  currentUserId,
  events,
  isPending = false,
  isError = false,
}: AgreementStatusHistoryProps) {
  const agreementEvents = events.filter((event) => event.agreement_id === agreementId);

  return (
    <details className="mt-4 border-t pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium marker:hidden">
        <Clock3 className="h-4 w-4 text-muted-foreground" />
        История статусов
        {!isPending && !isError && (
          <span className="text-xs font-normal text-muted-foreground">
            {agreementEvents.length}
          </span>
        )}
      </summary>
      <div className="mt-3 space-y-3 border-l pl-4">
        {agreementEvents.map((event) => {
          const actor =
            event.changed_by == null
              ? "Система"
              : event.changed_by === currentUserId
                ? "Вы"
                : event.changed_by === ownerId
                  ? "Собственник"
                  : "Арендатор";

          return (
            <div key={event.id} className="relative text-sm">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
              <p>
                {event.from_status == null
                  ? `Договор создан со статусом «${agreementStatusLabels[event.to_status]}»`
                  : `Статус изменён: «${agreementStatusLabels[event.from_status]}» → «${agreementStatusLabels[event.to_status]}»`}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {actor} · {formatDateTime(event.created_at)}
              </p>
            </div>
          );
        })}
        {isPending && <p className="text-sm text-muted-foreground">Загружаем историю…</p>}
        {isError && <p className="text-sm text-destructive">Не удалось загрузить историю.</p>}
        {!isPending && !isError && agreementEvents.length === 0 && (
          <p className="text-sm text-muted-foreground">Событий пока нет.</p>
        )}
      </div>
    </details>
  );
}
