import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, localDateKey } from "@/lib/domain";
import {
  repairStatusLabels,
  repairActionLabels,
  repairMoney,
  repairOverdue,
  repairAmount,
  type RepairJob,
  type RepairEvent,
} from "@/lib/repairs";
import { actOnRepair } from "@/lib/repair-queries";
import { REPAIR_PHOTOS, uploadFile, removeFile, getSignedUrl } from "@/lib/storage";

function RepairPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null),
    [failed, setFailed] = useState(false),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    getSignedUrl(REPAIR_PHOTOS, path, 120)
      .then((value) => {
        if (active) setUrl(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [path]);
  return (
    <>
      <button
        type="button"
        aria-label="Открыть фото результата"
        className="overflow-hidden rounded-lg border"
        disabled={!url}
        onClick={() => setOpen(true)}
      >
        {url ? (
          <img
            src={url}
            alt="Фото результата ремонта"
            className="aspect-square w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex aspect-square items-center justify-center p-2 text-xs text-muted-foreground">
            {failed ? "Фото недоступно" : "Загружаем фото…"}
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Фото результата ремонта</DialogTitle>
          </DialogHeader>
          {url && (
            <img
              src={url}
              alt="Фото результата ремонта крупно"
              className="max-h-[75vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

const actionNames: Record<string, string> = {
  submit: "Отправить смету",
  approve: "Согласовать смету",
  reject: "Вернуть смету",
  start: "Начать работу",
  report: "Передать на приёмку",
  accept: "Принять работу",
  return: "Вернуть на доработку",
  cancel: "Отменить работу",
  expense: "Создать расход",
};
function RepairActionDialog({
  job,
  action,
  userId,
  onClose,
  onSaved,
}: {
  job: RepairJob;
  action: string;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState(""),
    [amount, setAmount] = useState(String(job.estimated_total ?? "")),
    [files, setFiles] = useState<File[]>([]);
  const isReport = action === "report",
    overrun = action === "accept" && (job.actual_amount ?? 0) > (job.estimated_total ?? 0);
  const noteRequired = isReport || overrun || ["reject", "return", "cancel"].includes(action);
  const mutation = useMutation({
    mutationFn: async () => {
      if (noteRequired && !note.trim()) throw new Error("Укажите пояснение");
      if (!isReport) return actOnRepair(job, action, { note: note.trim() });
      if (!files.length || files.length > 8) throw new Error("Приложите от 1 до 8 фото результата");
      const actual = repairAmount(amount),
        uploaded: string[] = [];
      try {
        for (const file of files)
          uploaded.push(await uploadFile(REPAIR_PHOTOS, `${userId}/${job.id}`, file));
        return await actOnRepair(job, action, {
          note: note.trim(),
          actual_amount: actual,
          photos: uploaded,
        });
      } catch (error) {
        for (const path of uploaded) await removeFile(REPAIR_PHOTOS, path).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success(action === "expense" ? "Плановый расход создан" : "Изменения сохранены");
      onSaved();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{actionNames[action]}</DialogTitle>
          <DialogDescription>{job.title}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {action === "approve" && (
            <p className="text-sm">
              Смета: <strong>{repairMoney(job.estimated_total)}</strong>. Исполнитель:{" "}
              {job.contractor_snapshot?.name}. Срок: {formatDate(job.due_date)}.
            </p>
          )}
          {action === "accept" && (
            <div className="space-y-2 text-sm">
              <p>
                Смета: {repairMoney(job.estimated_total)}. Стоимость по отчёту:{" "}
                <strong>{repairMoney(job.actual_amount)}</strong>.
              </p>
              {overrun && (
                <p className="rounded-lg border border-amber-300 p-3">
                  Стоимость превышает смету. Принимая работу, вы согласуете эту итоговую стоимость;
                  укажите причину.
                </p>
              )}
              <p>Связанная заявка будет закрыта. Оплата оформляется отдельно.</p>
            </div>
          )}
          {action === "expense" && (
            <p className="text-sm">
              Будет создан один плановый расход на <strong>{repairMoney(job.actual_amount)}</strong>
              . Дату оплаты, фактический платёж и чек можно будет указать в разделе расходов.
            </p>
          )}
          {action === "submit" && (
            <p className="text-sm">
              Отправить смету на {repairMoney(job.estimated_total)} собственнику? До его
              согласования работа не начнётся.
            </p>
          )}
          {action === "start" && (
            <p className="text-sm">
              Начать работу по согласованной смете? Связанная заявка перейдёт в статус «В работе».
            </p>
          )}
          {isReport && (
            <>
              <div className="space-y-1">
                <Label htmlFor="repair-actual">Стоимость по отчёту, ₽</Label>
                <Input
                  id="repair-actual"
                  inputMode="decimal"
                  value={amount}
                  required
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="repair-photos">Фото результата</Label>
                <Input
                  id="repair-photos"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    setFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  От 1 до 8 фото JPG, PNG или WebP, до 8 МБ каждое.
                </p>
                {files.map((file, i) => (
                  <p className="break-all text-xs" key={`${file.name}-${i}`}>
                    {file.name}
                  </p>
                ))}
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="repair-decision-note">
              {isReport
                ? "Описание результата"
                : overrun
                  ? "Обоснование превышения сметы"
                  : "Комментарий к действию"}
              {noteRequired ? " *" : ""}
            </Label>
            <Textarea
              id="repair-decision-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              required={noteRequired}
            />
          </div>
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
              Отмена
            </Button>
            <Button disabled={mutation.isPending}>
              {mutation.isPending ? "Сохраняем…" : actionNames[action]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RepairDetails({
  job,
  events,
  userId,
  onEdit,
  onRefresh,
}: {
  job: RepairJob;
  events: RepairEvent[];
  userId: string;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const [decision, setDecision] = useState<{ job: RepairJob; action: string } | null>(null),
    [history, setHistory] = useState<RepairEvent | null>(null);
  const owner = job.role === "owner",
    editable = owner || job.role === "manager",
    internal = job.role !== "tenant";
  const actions: string[] = [];
  if (editable && job.status === "draft" && job.contractor_id) actions.push("submit");
  if (owner && job.status === "pending") actions.push("approve", "reject");
  if (editable && job.status === "approved") actions.push("start");
  if (editable && job.status === "in_progress") actions.push("report");
  if (owner && job.status === "review") actions.push("accept", "return");
  if (owner && job.status === "completed" && !job.expense_id) actions.push("expense");
  if (owner && !["completed", "cancelled"].includes(job.status)) actions.push("cancel");
  return (
    <Card data-testid="repair-job">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="break-words">{job.title}</CardTitle>
          <span role="status" className="rounded-full bg-accent px-3 py-1 text-xs">
            {repairStatusLabels[job.status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {job.property_name}
          {job.request_title ? ` · Заявка: ${job.request_title}` : " · Плановое обслуживание"}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="whitespace-pre-wrap break-words text-sm">{job.description}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <p>Начало: {formatDate(job.scheduled_date)}</p>
          <p>Срок: {formatDate(job.due_date)}</p>
          {repairOverdue(job, localDateKey()) && <p className="text-destructive">Срок просрочен</p>}
          {job.completed_at && <p>Принято: {formatDateTime(job.completed_at)}</p>}
        </div>
        {internal && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-muted/60 p-4">
                <p className="text-xs text-muted-foreground">
                  {job.published_at ? "Согласованная смета" : "Предложенная смета"}
                </p>
                <p className="mt-1 font-semibold">{repairMoney(job.estimated_total)}</p>
              </div>
              <div className="rounded-xl bg-muted/60 p-4">
                <p className="text-xs text-muted-foreground">Стоимость по отчёту</p>
                <p className="mt-1 font-semibold">{repairMoney(job.actual_amount)}</p>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border p-4">
              <p className="font-medium">
                Исполнитель: {job.contractor_snapshot?.name ?? "Не назначен"}
              </p>
              {job.contractor_snapshot && (
                <p className="break-words text-sm text-muted-foreground">
                  {[
                    job.contractor_snapshot.specialty,
                    job.contractor_snapshot.phone,
                    job.contractor_snapshot.email,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {!job.contractor_id && (
                <p className="text-sm text-muted-foreground">
                  Для отправки сметы собственник должен назначить исполнителя.
                </p>
              )}
            </div>
            <details className="rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Строки сметы · {job.estimate_items.length}
              </summary>
              <div className="mt-3 space-y-2">
                {job.estimate_items.map((item, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="break-words">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.quantity} × {repairMoney(item.unit_price)}
                      </p>
                    </div>
                    <span>{repairMoney(item.amount)}</span>
                  </div>
                ))}
              </div>
            </details>
            {job.decision_note && (
              <p className="whitespace-pre-wrap break-words rounded-xl border p-3 text-sm">
                Комментарий согласования: {job.decision_note}
              </p>
            )}
          </>
        )}
        {job.result_note && (
          <section className="space-y-3">
            <h3 className="font-medium">Отчёт о результате</h3>
            <p className="whitespace-pre-wrap break-words text-sm">{job.result_note}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {job.result_photos.map((path) => (
                <RepairPhoto key={path} path={path} />
              ))}
            </div>
            {job.status === "review" && (
              <p className="text-sm text-muted-foreground">
                Результат ожидает приёмки собственником.
              </p>
            )}
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {editable && job.status === "draft" && (
            <Button variant="outline" onClick={onEdit}>
              Изменить смету
            </Button>
          )}
          {actions.map((action) => (
            <Button
              key={action}
              variant={["cancel", "reject", "return"].includes(action) ? "outline" : "default"}
              onClick={() => setDecision({ job, action })}
            >
              {actionNames[action]}
            </Button>
          ))}
          {owner && job.expense_id && (
            <Button variant="outline" asChild>
              <Link
                to="/finances"
                search={{
                  property: job.property_id,
                  from: job.completed_at!.slice(0, 7),
                  to: job.completed_at!.slice(0, 7),
                }}
              >
                Открыть созданный расход
              </Link>
            </Button>
          )}
        </div>
        {job.status === "completed" && internal && (
          <p className="text-xs text-muted-foreground">
            Стоимость принятой работы не означает оплату.{" "}
            {job.expense_id
              ? "Расход уже создан; повторно добавлять его не нужно."
              : "Собственник может перенести итоговую стоимость в плановые расходы."}
          </p>
        )}
        {internal && events.length > 0 && (
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              История работы · {events.length}
            </summary>
            <div className="mt-3 space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-muted/40 p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {repairActionLabels[event.action] ?? event.action}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.actor_name} · {formatDateTime(event.created_at)} · версия{" "}
                      {event.snapshot.revision}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setHistory(event)}>
                    Открыть версию {event.snapshot.revision}
                  </Button>
                </div>
              ))}
            </div>
          </details>
        )}
        {decision && (
          <RepairActionDialog
            job={decision.job}
            action={decision.action}
            userId={userId}
            onClose={() => setDecision(null)}
            onSaved={() => {
              setDecision(null);
              onRefresh();
            }}
          />
        )}
        {history && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setHistory(null);
            }}
          >
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  Версия {history.snapshot.revision}: {history.snapshot.title}
                </DialogTitle>
                <DialogDescription>
                  {repairActionLabels[history.action]} · {history.actor_name} ·{" "}
                  {formatDateTime(history.created_at)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p>
                  {repairStatusLabels[history.snapshot.status]} · Смета:{" "}
                  {repairMoney(history.snapshot.estimated_total)} · Стоимость по отчёту:{" "}
                  {repairMoney(history.snapshot.actual_amount)}
                </p>
                <p>Исполнитель: {history.snapshot.contractor_snapshot?.name ?? "Не назначен"}</p>
                <p>Срок: {formatDate(history.snapshot.due_date)}</p>
                {history.snapshot.estimate_items.map((item, i) => (
                  <p key={i} className="break-words">
                    {item.name}: {item.quantity} × {repairMoney(item.unit_price)} ={" "}
                    {repairMoney(item.amount)}
                  </p>
                ))}
                <p className="whitespace-pre-wrap break-words">
                  {history.snapshot.result_note || history.snapshot.decision_note}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {history.snapshot.result_photos.map((path) => (
                    <RepairPhoto key={path} path={path} />
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}
