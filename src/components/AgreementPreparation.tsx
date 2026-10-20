import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAgreementPreparation } from "@/lib/rental-onboarding";

export function AgreementPreparation({
  preparation,
  agreementId,
  onSend,
  onUpload,
  busy,
}: {
  preparation: ReturnType<typeof getAgreementPreparation>;
  agreementId: string;
  onSend: () => void;
  onUpload: () => void;
  busy: boolean;
}) {
  const { steps, nextStep, canActivate } = preparation;
  const needsDocument = !steps.find((step) => step.id === "document")?.completed;
  return (
    <section
      aria-label="Подготовка к активации"
      data-testid={`agreement-preparation-${agreementId}`}
      className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.025] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Подготовка к активации</h3>
        <span className="text-xs text-muted-foreground">
          Готово {steps.filter((step) => step.completed).length} из {steps.length}
        </span>
      </div>
      <ol className="mt-3 grid gap-3 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 text-sm">
            {step.completed ? (
              <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <Circle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            )}
            <span>
              <span className="sr-only">{step.completed ? "Готово: " : "Ожидается: "}</span>
              {step.title}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        {canActivate
          ? "Всё готово. Нажмите «Активировать», чтобы сформировать начисления по договору."
          : nextStep?.id === "tenant"
            ? "Передайте арендатору приглашение. Ему нужно зарегистрироваться с email из карточки арендатора."
            : nextStep?.id === "sent"
              ? "Отправьте договор на подписание, чтобы арендатор увидел условия в своём кабинете."
              : nextStep?.id === "accepted"
                ? "Ожидаем подтверждения текущих условий в кабинете арендатора. Подписанный PDF может загрузить любой из участников."
                : "Загрузите PDF с подписями сторон. После этого договор можно активировать."}
      </p>
      {!canActivate && (nextStep?.id === "tenant" || nextStep?.id === "sent" || needsDocument) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {nextStep?.id === "tenant" && (
            <Button asChild variant="outline" size="sm">
              <Link to="/tenants">Пригласить арендатора</Link>
            </Button>
          )}
          {nextStep?.id === "sent" && (
            <Button
              size="sm"
              className="h-auto max-w-full whitespace-normal text-left"
              disabled={busy}
              onClick={onSend}
            >
              <Send className="mr-2 h-4 w-4" />
              Отправить на подписание
            </Button>
          )}
          {needsDocument && (
            <Button
              variant="outline"
              size="sm"
              className="h-auto max-w-full whitespace-normal text-left"
              disabled={busy}
              onClick={onUpload}
            >
              <Upload className="mr-2 h-4 w-4" />
              Загрузить подписанный PDF
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
