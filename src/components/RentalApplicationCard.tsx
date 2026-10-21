import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { applicationLabels, openApplication, type RentalApplication } from "@/lib/recruitment";
import { actOnApplication } from "@/lib/recruitment-queries";
import { formatDateTime, formatMoney } from "@/lib/domain";
export function RentalApplicationCard({
  application: a,
  operator = false,
  owner = false,
  onSaved,
}: {
  application: RentalApplication;
  operator?: boolean;
  owner?: boolean;
  onSaved: () => void;
}) {
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState(a.public_note);
  const [internal, setInternal] = useState(a.operator_note ?? "");
  const [showing, setShowing] = useState("");
  const [start, setStart] = useState(a.offer.available_from);
  const [end, setEnd] = useState("");
  const [due, setDue] = useState("1");
  const mutation = useMutation({
    mutationFn: () =>
      actOnApplication(a.id, action!, a.revision, {
        public_note: note,
        operator_note: internal,
        ...(action === "schedule" ? { showing_at: new Date(showing).toISOString() } : {}),
        ...(action === "accept"
          ? { start_date: start, end_date: end, payment_due_day: Number(due) }
          : {}),
      }),
    onSuccess: () => {
      toast.success(
        action === "accept" ? "Кандидат выбран. Создан черновик договора." : "Заявка обновлена",
      );
      setAction(null);
      onSaved();
    },
    onError: (e: Error) => {
      setError(e.message);
      onSaved();
    },
  });
  const titles: Record<string, string> = {
    schedule: "Назначить показ",
    shortlist: "В короткий список",
    reject: "Отклонить отклик",
    withdraw: "Отозвать отклик",
    accept: "Выбрать кандидата",
    note: "Обновить сообщение",
    undo_selection: "Отменить выбор",
  };
  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <h3 className="break-words font-semibold">{operator ? a.name : a.offer.title}</h3>
              <p className="text-sm text-muted-foreground">
                {operator ? a.offer.title : a.offer.location}
              </p>
            </div>
            <span className="text-sm font-medium text-primary">{applicationLabels[a.status]}</span>
          </div>
          <p className="text-sm">
            Условия отклика: {formatMoney(a.offer.monthly_rent)}/мес. · депозит{" "}
            {formatMoney(a.offer.deposit)}
          </p>
          {operator && (
            <>
              <p className="break-words text-sm">
                {a.email} · {a.phone}
              </p>
              {a.message && <p className="whitespace-pre-wrap break-words text-sm">{a.message}</p>}
            </>
          )}
          {a.showing_at && a.status === "showing" && (
            <p className="rounded-lg bg-primary/10 p-3 text-sm font-medium">
              Показ: {formatDateTime(a.showing_at)}
            </p>
          )}
          {a.public_note && (
            <p className="whitespace-pre-wrap break-words text-sm">
              Сообщение кандидату: {a.public_note}
            </p>
          )}
          {operator && a.operator_note && (
            <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
              Внутренняя заметка: {a.operator_note}
            </p>
          )}
          {a.status === "accepted" && (
            <p className="text-sm text-muted-foreground">
              Собственник готовит договор. Он появится в кабинете арендатора после передачи на
              подписание.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {openApplication(a) &&
              (operator
                ? ["schedule", "shortlist", "note", "reject", ...(owner ? ["accept"] : [])]
                : ["withdraw"]
              ).map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={v === "accept" ? "default" : "outline"}
                  onClick={() => {
                    setError("");
                    setAction(v);
                  }}
                >
                  {titles[v]}
                </Button>
              ))}
            {owner && a.status === "accepted" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError("");
                  setAction("undo_selection");
                }}
              >
                Отменить выбор
              </Button>
            )}
            {owner && a.agreement_id && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/agreements">Открыть договоры</Link>
              </Button>
            )}
            {!operator && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/listing/$listingId" params={{ listingId: a.public_id }}>
                  Карточка объявления
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {action && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v && !mutation.isPending) setAction(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{titles[action]}</DialogTitle>
              <DialogDescription>
                {action === "accept"
                  ? "Будет создан черновик договора по условиям, на которые откликнулся кандидат. Объявление закроется, остальные отклики по нему будут отклонены. Подписание и активация — в разделе договоров."
                  : action === "undo_selection"
                    ? "Отмена доступна до подготовки PDF и передачи договора на подписание. Объявление будет снято с публикации. Неиспользованный черновик договора останется в разделе договоров; удалите его перед работой с новым кандидатом."
                    : action === "withdraw"
                      ? "Собственник увидит, что вы отозвали заявку. Повторная подача по этому объявлению недоступна."
                      : "Сообщение кандидату появится в его кабинете. Внутренняя заметка доступна собственнику и управляющим."}
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                mutation.mutate();
              }}
            >
              {action === "schedule" && (
                <div className="space-y-1.5">
                  <Label htmlFor="showing-at">Дата и время показа (ваш часовой пояс)</Label>
                  <Input
                    id="showing-at"
                    type="datetime-local"
                    value={showing}
                    onChange={(e) => setShowing(e.target.value)}
                    required
                  />
                </div>
              )}
              {action === "accept" && (
                <>
                  <p className="text-sm">
                    {formatMoney(a.offer.monthly_rent)}/мес. · депозит{" "}
                    {formatMoney(a.offer.deposit)}
                  </p>
                  <Label htmlFor="candidate-start">Начало аренды</Label>
                  <Input
                    id="candidate-start"
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    required
                  />
                  <Label htmlFor="candidate-end">Окончание аренды</Label>
                  <Input
                    id="candidate-end"
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    required
                  />
                  <Label htmlFor="candidate-due">День оплаты</Label>
                  <Input
                    id="candidate-due"
                    type="number"
                    min={1}
                    max={31}
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    required
                  />
                </>
              )}
              {action !== "withdraw" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="candidate-note">Сообщение кандидату</Label>
                    <Textarea
                      id="candidate-note"
                      maxLength={2000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      required={action === "reject" || action === "undo_selection"}
                    />
                  </div>
                  {action !== "accept" && action !== "undo_selection" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="candidate-internal">Внутренняя заметка</Label>
                      <Textarea
                        id="candidate-internal"
                        maxLength={2000}
                        value={internal}
                        onChange={(e) => setInternal(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAction(null)}
                  disabled={mutation.isPending}
                >
                  Отмена
                </Button>
                <Button disabled={mutation.isPending}>
                  {mutation.isPending ? "Сохранение…" : "Подтвердить"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
