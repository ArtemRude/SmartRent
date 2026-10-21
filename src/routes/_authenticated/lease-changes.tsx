import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { LeaseChangeEditor } from "@/components/LeaseChangeEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/auth-context";
import { fetchAgreements, fetchProperties, fetchTenants } from "@/lib/queries";
import { formatDate, formatDateTime, localDateKey } from "@/lib/domain";
import { actOnLeaseChange, fetchLeaseChanges } from "@/lib/lease-change-queries";
import {
  amendmentLabels,
  amendmentMoney,
  nextRentMonth,
  rentAt,
  type LeaseAmendment,
} from "@/lib/lease-changes";
import { openLeaseChangeReport } from "@/lib/lease-change-report";
export const Route = createFileRoute("/_authenticated/lease-changes")({
  validateSearch: (search: Record<string, unknown>): { agreement?: string } =>
    typeof search["agreement"] === "string" ? { agreement: search["agreement"] } : {},
  head: () => ({ meta: [{ title: "Изменения условий — SmartRent" }] }),
  component: LeaseChangesPage,
});
const actionLabels = {
  submit: "Отправить арендатору",
  accept: "Подтвердить новые условия",
  reject: "Отклонить предложение",
  cancel: "Отменить предложение",
};
type Action = keyof typeof actionLabels;
function LeaseChangesPage() {
  const { user, role } = useAuth();
  const manager = role !== "tenant";
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    qc = useQueryClient();
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const changes = useQuery({
    queryKey: ["lease-changes", user?.id],
    queryFn: fetchLeaseChanges,
    enabled: Boolean(user),
    refetchInterval: role === "admin" ? 5000 : 30_000,
  });
  const termsVersion = changes.data?.amendments
    .map((m) => `${m.id}:${m.revision}`)
    .sort()
    .join("|");
  useEffect(() => {
    if (termsVersion === undefined) return;
    // Decisions notify the owner; administrators also need the updated agreement after polling.
    for (const key of ["agreements", "rent-charges", "property-finances", "property-timeline"])
      void qc.invalidateQueries({ queryKey: [key] });
  }, [termsVersion, qc]);
  const queries = [agreements, properties, tenants, changes],
    loading = queries.some((q) => q.isPending),
    failed = queries.some((q) => q.isError);
  const eligible = (agreements.data ?? []).filter(
    (a) => a.status === "active" || a.status === "completed",
  );
  const agreement = search.agreement
    ? eligible.find((a) => a.id === search.agreement)
    : (eligible.find((a) => a.status === "active") ?? eligible[0]);
  const proposals = (changes.data?.amendments ?? [])
    .filter((m) => m.agreement_id === agreement?.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const open = proposals.some((m) => m.status === "draft" || m.status === "pending");
  const latest = proposals
    .filter((m) => m.status === "accepted")
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const defaultMonth = nextRentMonth(localDateKey());
  const minimum =
    latest && latest.effective_from >= defaultMonth
      ? nextRentMonth(latest.effective_from)
      : defaultMonth;
  const [editing, setEditing] = useState<{ initial: LeaseAmendment | null } | null>(null);
  const [decision, setDecision] = useState<{ proposal: LeaseAmendment; action: Action } | null>(
    null,
  );
  const [note, setNote] = useState("");
  const refresh = () => {
    for (const key of [
      "lease-changes",
      "agreements",
      "rent-charges",
      "property-finances",
      "property-timeline",
      "notifications",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const act = useMutation({
    mutationFn: async () => {
      if (!decision) return;
      if (decision.action === "reject" && !note.trim()) throw new Error("Укажите причину отказа");
      await actOnLeaseChange(decision.proposal, decision.action, note);
    },
    onSuccess: () => {
      toast.success("Действие сохранено");
      setDecision(null);
      refresh();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      refresh();
    },
  });
  const choose = (proposal: LeaseAmendment, action: Action) => {
    setNote("");
    setDecision({ proposal, action });
  };
  const agreementName = (id: string) => {
    const a = eligible.find((item) => item.id === id);
    return `${properties.data?.find((p) => p.id === a?.property_id)?.name ?? "Объект"} · ${tenants.data?.find((t) => t.id === a?.tenant_id)?.name ?? "Арендатор"}`;
  };
  const pending = (changes.data?.amendments ?? []).filter((m) => m.status === "pending");
  return (
    <>
      <PageHeader
        title="Изменения условий"
        description="Продление действующей аренды, новая ставка и дополнительные соглашения"
        action={
          <Button
            variant="outline"
            disabled={queries.some((q) => q.isFetching)}
            onClick={() => {
              for (const q of queries) void q.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
        }
      />
      {loading && (
        <p className="text-sm text-muted-foreground">Загружаем договоры и предложения…</p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Не удалось загрузить изменения. Нажмите «Обновить».
        </p>
      )}
      {!loading && !failed && !changes.data?.available && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Согласование новых условий пока недоступно. Попробуйте открыть раздел позже.
          </CardContent>
        </Card>
      )}
      {!loading && !failed && changes.data?.available && (
        <div className="space-y-5">
          {pending.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <h2 className="font-medium">Ожидают согласования</h2>
                <div className="flex flex-wrap gap-2">
                  {pending.map((m) => (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto whitespace-normal text-left"
                      key={m.id}
                      onClick={() => void navigate({ search: { agreement: m.agreement_id } })}
                    >
                      {agreementName(m.agreement_id)} · {amendmentMoney(m.monthly_payment)} с{" "}
                      {formatDate(m.effective_from)}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {eligible.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="change-agreement">Договор</Label>
              <select
                id="change-agreement"
                className="h-10 w-full max-w-xl rounded-md border bg-background px-3 text-sm"
                value={agreement?.id ?? ""}
                onChange={(e) => void navigate({ search: { agreement: e.target.value } })}
              >
                <option value="" disabled>
                  Выберите договор
                </option>
                {eligible.map((a) => (
                  <option key={a.id} value={a.id}>
                    {agreementName(a.id)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!agreement && (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
                <p>
                  {search.agreement
                    ? "Этот договор недоступен для просмотра изменений. Выберите договор из списка."
                    : "Для изменения условий нужен действующий договор. История остаётся доступной после завершения."}
                </p>
                <Button asChild variant="outline">
                  <Link to={manager ? "/agreements" : "/cabinet"}>Открыть договоры</Link>
                </Button>
              </CardContent>
            </Card>
          )}
          {agreement && (
            <>
              <Card>
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-medium">{agreementName(agreement.id)}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Текущая ставка: {amendmentMoney(rentAt(agreement, localDateKey()))}/мес. ·
                        До {formatDate(agreement.end_date)}
                      </p>
                    </div>
                    {manager && agreement.status === "active" && (
                      <Button disabled={open} onClick={() => setEditing({ initial: null })}>
                        <Plus className="mr-2 h-4 w-4" />
                        Предложить новые условия
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Новая ставка применяется с первого числа выбранного месяца после подтверждения
                    арендатора. Прежний договор и история сохраняются; начисления за месяцы до
                    выбранной даты не пересчитываются. Согласованное продление сразу добавляет
                    месяцы в график, новая ставка применяется только с указанной даты.
                  </p>
                  {manager && open && (
                    <p className="text-sm text-muted-foreground">
                      Сначала отправьте или отмените открытое предложение.
                    </p>
                  )}
                  {role === "admin" && agreement.owner_id !== user?.id && (
                    <p className="text-sm text-muted-foreground">
                      Вы оформляете изменение как администратор. Подтверждение выполняет арендатор в
                      своём кабинете.
                    </p>
                  )}
                  {agreement.status === "completed" && (
                    <p className="text-sm text-muted-foreground">
                      Договор завершён. Здесь сохранена история; новый договор можно подготовить в
                      разделе договоров.
                    </p>
                  )}
                </CardContent>
              </Card>
              {proposals.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Предложений по этому договору пока нет.
                </p>
              )}
              {proposals.map((m) => (
                <Card key={m.id} data-testid="lease-amendment">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="text-lg">Дополнительное соглашение</CardTitle>
                      <span role="status" className="rounded-full bg-accent px-3 py-1 text-xs">
                        {amendmentLabels[m.status]}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-muted-foreground">
                          Ставка с {formatDate(m.effective_from)}
                        </p>
                        <p className="mt-1 font-medium">
                          {amendmentMoney(m.previous_monthly_payment)} →{" "}
                          {amendmentMoney(m.monthly_payment)}/мес.
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Окончание аренды</p>
                        <p className="mt-1 font-medium">
                          {formatDate(m.previous_end_date)} → {formatDate(m.end_date)}
                        </p>
                      </div>
                    </div>
                    {m.note && <p className="whitespace-pre-wrap break-words text-sm">{m.note}</p>}
                    {m.review_note && (
                      <p className="whitespace-pre-wrap break-words rounded-lg border border-destructive/30 p-3 text-sm">
                        Причина отказа: {m.review_note}
                      </p>
                    )}
                    {m.status === "accepted" && (
                      <p className="text-sm text-success">
                        Арендатор подтвердил условия {formatDateTime(m.decided_at)}. Ставка{" "}
                        {amendmentMoney(m.monthly_payment)} применяется с{" "}
                        {formatDate(m.effective_from)}.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {manager && m.status === "draft" && (
                        <>
                          <Button variant="outline" onClick={() => setEditing({ initial: m })}>
                            Изменить предложение
                          </Button>
                          <Button onClick={() => choose(m, "submit")}>Отправить арендатору</Button>
                        </>
                      )}
                      {manager && (m.status === "draft" || m.status === "pending") && (
                        <Button variant="ghost" onClick={() => choose(m, "cancel")}>
                          Отменить предложение
                        </Button>
                      )}
                      {!manager && m.status === "pending" && (
                        <>
                          <Button onClick={() => choose(m, "accept")}>
                            Подтвердить новые условия
                          </Button>
                          <Button variant="outline" onClick={() => choose(m, "reject")}>
                            Отклонить предложение
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => {
                          try {
                            openLeaseChangeReport(m);
                          } catch (e) {
                            toast.error((e as Error).message);
                          }
                        }}
                      >
                        <FileDown className="mr-2 h-4 w-4" />
                        Соглашение / PDF
                      </Button>
                    </div>
                    <details className="rounded-lg border p-3 text-sm">
                      <summary className="cursor-pointer font-medium">История предложения</summary>
                      <div className="mt-3 space-y-3">
                        {(changes.data?.events ?? [])
                          .filter((e) => e.amendment_id === m.id)
                          .sort(
                            (a, b) =>
                              Number((b.snapshot as unknown as LeaseAmendment).revision) -
                              Number((a.snapshot as unknown as LeaseAmendment).revision),
                          )
                          .map((e) => {
                            const snapshot = e.snapshot as unknown as LeaseAmendment;
                            return (
                              <div key={e.id} className="space-y-1 border-t pt-3">
                                <p className="text-xs text-muted-foreground">
                                  {formatDateTime(e.created_at)} · версия {snapshot.revision} ·{" "}
                                  {amendmentLabels[snapshot.status]}
                                </p>
                                <p>
                                  {amendmentMoney(snapshot.monthly_payment)} с{" "}
                                  {formatDate(snapshot.effective_from)} · до{" "}
                                  {formatDate(snapshot.end_date)}
                                </p>
                                {snapshot.note && (
                                  <p className="whitespace-pre-wrap break-words">{snapshot.note}</p>
                                )}
                                {snapshot.review_note && (
                                  <p className="whitespace-pre-wrap break-words">
                                    {snapshot.review_note}
                                  </p>
                                )}
                                <Button
                                  variant="link"
                                  className="h-auto p-0"
                                  size="sm"
                                  onClick={() => {
                                    try {
                                      openLeaseChangeReport(snapshot);
                                    } catch (e) {
                                      toast.error((e as Error).message);
                                    }
                                  }}
                                >
                                  Соглашение этой версии
                                </Button>
                              </div>
                            );
                          })}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>
      )}
      {editing && agreement && (
        <LeaseChangeEditor
          key={editing.initial?.id ?? agreement.id}
          agreement={agreement}
          initial={editing.initial}
          minimum={minimum}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      <Dialog
        open={Boolean(decision)}
        onOpenChange={(open) => {
          if (!open && !act.isPending) setDecision(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision ? actionLabels[decision.action] : "Действие с предложением"}
            </DialogTitle>
            <DialogDescription>
              {decision?.action === "accept"
                ? "Подтверждение изменит будущие арендные начисления и продлит срок, если он указан. Это согласование условий в кабинете; банковская оплата не выполняется."
                : decision?.action === "submit"
                  ? "После отправки условия нельзя менять до решения арендатора. До его подтверждения договор и начисления сохраняются."
                  : decision?.action === "cancel"
                    ? "Предложение останется в истории. Согласованные ранее условия сохранятся."
                    : "Укажите причину отказа. Договор и начисления сохранят прежние условия."}
            </DialogDescription>
          </DialogHeader>
          {decision && (
            <p className="text-sm">
              {amendmentMoney(decision.proposal.monthly_payment)}/мес. с{" "}
              {formatDate(decision.proposal.effective_from)} · до{" "}
              {formatDate(decision.proposal.end_date)}
            </p>
          )}
          {decision?.action === "reject" && (
            <div className="space-y-2">
              <Label htmlFor="change-review">Причина отказа</Label>
              <Textarea
                id="change-review"
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={act.isPending} onClick={() => setDecision(null)}>
              Назад
            </Button>
            <Button disabled={act.isPending} onClick={() => act.mutate()}>
              {act.isPending ? "Сохраняем…" : "Подтвердить действие"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
