import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, FileDown, Pencil, Send } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { HandoverEditor } from "@/components/HandoverEditor";
import { HandoverDetails } from "@/components/HandoverDetails";
import { HandoverPhoto } from "@/components/HandoverPhoto";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/auth-context";
import { readAgreementContractDetails } from "@/lib/agreement-document";
import { formatDateTime } from "@/lib/domain";
import { actOnHandover, fetchHandovers } from "@/lib/handover-queries";
import { handoverStatusLabels, type HandoverKind, type LeaseHandover } from "@/lib/handovers";
import { openHandoverReport } from "@/lib/handover-report";
import {
  fetchAgreements,
  fetchProperties,
  fetchTenants,
  fetchAgreementAcceptances,
} from "@/lib/queries";
import { AGREEMENT_INVENTORY_PHOTOS, HANDOVER_PHOTOS } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/handover")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { agreement?: string; kind?: HandoverKind } => ({
    ...(typeof search["agreement"] === "string" ? { agreement: search["agreement"] } : {}),
    ...(search["kind"] === "move_in" || search["kind"] === "move_out"
      ? { kind: search["kind"] }
      : {}),
  }),
  head: () => ({ meta: [{ title: "Заселение и выезд — SmartRent" }] }),
  component: HandoverPage,
});

const actions = {
  submit: {
    title: "Отправить акт арендатору",
    description:
      "Проверьте осмотр, фотографии и суммы. После отправки акт нельзя изменить до решения арендатора.",
  },
  confirm: {
    title: "Подтвердить акт",
    description:
      "Вы подтверждаете состояние помещения, количество ключей и указанный расчёт депозита. Если есть расхождения, оставьте замечания.",
  },
  dispute: {
    title: "Оставить замечания",
    description: "Опишите расхождения. Собственник сможет исправить акт и отправить новую версию.",
  },
  mark_refunded: {
    title: "Отметить возврат депозита",
    description:
      "Используйте это действие после фактической передачи денег арендатору. Сервис сохранит отметку, а арендатор сможет подтвердить получение.",
  },
  confirm_refund: {
    title: "Подтвердить получение депозита",
    description:
      "Подтвердите только после получения денег от собственника. Будет сохранена дата вашего подтверждения.",
  },
  complete: {
    title: "Завершить аренду",
    description:
      "Договор будет завершён по дате осмотра. Будущие неоплаченные арендные начисления удалятся. Текущие, прошедшие и оплаченные начисления сохранятся. Аренда за текущий месяц автоматически не пересчитывается; возврат депозита учитывается отдельно.",
  },
} as const;
type Action = keyof typeof actions;
const eventLabels: Record<string, string> = {
  draft_saved: "Черновик сохранён",
  submitted: "Отправлено арендатору",
  confirmed: "Акт подтверждён",
  disputed: "Получены замечания",
  refund_marked: "Возврат отмечен собственником",
  refund_confirmed: "Получение депозита подтверждено",
  completed: "Аренда завершена",
};

function HandoverPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { role, user } = useAuth();
  const owner = role !== "tenant";
  const qc = useQueryClient();
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const acceptances = useQuery({
    queryKey: ["agreement-acceptances"],
    queryFn: fetchAgreementAcceptances,
  });
  const data = useQuery({
    queryKey: ["handovers", user?.id],
    queryFn: fetchHandovers,
    enabled: Boolean(user),
    // Tenant decisions notify the lease owner. Admins also need updates while managing it.
    refetchInterval: role === "admin" ? 5_000 : 30_000,
  });
  const eligible = (agreements.data ?? []).filter(
    // Visibility is enforced by lease RLS. Admins can also manage another owner's lease.
    (item) => item.status === "active" || item.status === "completed",
  );
  const agreement = search.agreement
    ? eligible.find((item) => item.id === search.agreement)
    : (eligible.find((item) => item.status === "active") ?? eligible[0]);
  const kind = search.kind ?? "move_out";
  const report = data.data?.reports.find(
    (item) => item.agreement_id === agreement?.id && item.kind === kind,
  );
  const baseline = data.data?.reports.find(
    (item) =>
      item.agreement_id === agreement?.id && item.kind === "move_in" && item.status === "confirmed",
  );
  const acceptance = acceptances.data?.find((item) => item.agreement_id === agreement?.id);
  const property = properties.data?.find((item) => item.id === agreement?.property_id);
  const tenant = tenants.data?.find((item) => item.id === agreement?.tenant_id);
  const events = data.data?.events.filter((item) => item.handover_id === report?.id) ?? [];
  const [editing, setEditing] = useState<{
    agreementId: string;
    kind: HandoverKind;
    report: LeaseHandover | null;
    deposit: number;
    startDate: string;
  } | null>(null);
  const [decision, setDecision] = useState<{ report: LeaseHandover; action: Action } | null>(null);
  const [note, setNote] = useState("");
  const refresh = () => {
    for (const key of [
      "handovers",
      "agreements",
      "rent-charges",
      "agreement-status-events",
      "notifications",
      "property-timeline",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const act = useMutation({
    mutationFn: async () => {
      if (!decision) return;
      if (decision.action === "dispute" && !note.trim())
        throw new Error("Опишите замечания к акту");
      await actOnHandover(
        decision.report.id,
        decision.action,
        decision.report.revision,
        note.trim() || null,
      );
    },
    onSuccess: () => {
      toast.success("Действие сохранено");
      setDecision(null);
      refresh();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      refresh();
    },
  });
  const openAction = (action: Action) => {
    if (report) {
      setNote("");
      setDecision({ report, action });
    }
  };
  const queries = [agreements, properties, tenants, data];
  const loading = queries.some((query) => query.isPending);
  const failed = queries.some((query) => query.isError);
  const canEdit =
    owner &&
    agreement &&
    (kind === "move_out" || agreement.status === "active") &&
    (!report || report.status === "draft" || report.status === "disputed");
  const attention =
    data.data?.reports.filter((item) =>
      owner
        ? item.status === "disputed" ||
          (item.kind === "move_out" && item.status === "confirmed" && !item.completed_at)
        : item.status === "pending" || (item.refund_marked_at && !item.refund_confirmed_at),
    ) ?? [];
  const edit = () => {
    if (agreement)
      setEditing({
        agreementId: agreement.id,
        kind,
        report: report ?? null,
        startDate: agreement.start_date,
        deposit: Number(
          baseline?.deposit_received ??
            readAgreementContractDetails(agreement.contract_details).depositAmount ??
            0,
        ),
      });
  };
  const name = (id: string) => {
    const lease = eligible.find((item) => item.id === id);
    return `${properties.data?.find((item) => item.id === lease?.property_id)?.name ?? "Объект"} · ${tenants.data?.find((item) => item.id === lease?.tenant_id)?.name ?? "Арендатор"}`;
  };
  return (
    <>
      <PageHeader
        title="Заселение и выезд"
        description="Осмотр, передача ключей и согласование депозита"
      />
      {loading && <p className="text-sm text-muted-foreground">Загружаем акты…</p>}
      {failed && (
        <div className="mb-4 rounded-lg border border-destructive/30 p-4">
          <p className="text-sm text-destructive">Не удалось загрузить акты. Повторите попытку.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              for (const query of queries) void query.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      )}
      {!loading && !failed && data.data?.available === false && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Раздел актов пока недоступен. Попробуйте открыть его позже.
          </CardContent>
        </Card>
      )}
      {!loading && !failed && data.data?.available && (
        <div className="space-y-5">
          {attention.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h2 className="mb-2 font-medium">Требуют вашего внимания</h2>
                <div className="flex flex-wrap gap-2">
                  {attention.map((item) => (
                    <Button
                      key={item.id}
                      variant="outline"
                      size="sm"
                      className="h-auto max-w-full whitespace-normal text-left"
                      onClick={() =>
                        void navigate({ search: { agreement: item.agreement_id, kind: item.kind } })
                      }
                    >
                      {name(item.agreement_id)} · {item.kind === "move_in" ? "Заселение" : "Выезд"}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {eligible.length === 0 && !search.agreement && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Для осмотра нужен активный или завершённый договор.
                {owner && (
                  <Link to="/agreements" className="ml-1 text-primary underline">
                    Открыть договоры
                  </Link>
                )}
              </CardContent>
            </Card>
          )}
          {eligible.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="handover-agreement">Договор для осмотра</Label>
              <Select
                value={agreement?.id ?? ""}
                onValueChange={(id) => void navigate({ search: { agreement: id, kind } })}
              >
                <SelectTrigger id="handover-agreement" className="max-w-xl">
                  <SelectValue placeholder="Выберите договор" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {name(item.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {search.agreement && !agreement && (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
                <p>
                  Этот договор недоступен для осмотра. Нужен активный или завершённый договор, к
                  которому у вас есть доступ.
                </p>
                {eligible.length > 0 ? (
                  <p>Выберите другой договор из списка выше.</p>
                ) : owner ? (
                  <Button variant="outline" asChild>
                    <Link to="/agreements">Открыть договоры</Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          )}
          {agreement && (
            <>
              {role === "admin" && agreement.owner_id !== user?.id && (
                <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                  Вы оформляете акт как администратор. Подтвердить акт и получение депозита должен
                  арендатор в своём кабинете.
                </p>
              )}
              <Tabs
                value={kind}
                onValueChange={(value) =>
                  void navigate({
                    search: { agreement: agreement.id, kind: value as HandoverKind },
                  })
                }
              >
                <TabsList>
                  <TabsTrigger value="move_in">Заселение</TabsTrigger>
                  <TabsTrigger value="move_out">Выезд</TabsTrigger>
                </TabsList>
              </Tabs>
              {kind === "move_out" && (baseline || acceptance) && (
                <details className="rounded-xl border p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Сравнить с состоянием при заселении
                  </summary>
                  <div className="mt-4">
                    {baseline ? (
                      <HandoverDetails report={baseline} />
                    ) : (
                      <>
                        <p className="mb-3 text-sm text-muted-foreground">
                          Имущество и фотографии, приложенные при подтверждении договора.
                        </p>
                        <ul className="mb-3 space-y-1 text-sm">
                          {(
                            readAgreementContractDetails(agreement.contract_details)
                              .inventoryItems ?? []
                          ).map((item, i) => (
                            <li key={i}>
                              {item.name} · {item.quantity} · {item.condition}
                            </li>
                          ))}
                        </ul>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {acceptance?.photos.map((path, i) => (
                            <HandoverPhoto
                              key={path}
                              bucket={AGREEMENT_INVENTORY_PHOTOS}
                              path={path}
                              label={`Фото при заселении ${i + 1}`}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </details>
              )}
              <Card data-testid="handover-current">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <CardTitle className="text-lg">
                      {kind === "move_in" ? "Акт заселения" : "Акт выезда"}
                    </CardTitle>
                    {report && (
                      <span
                        className="rounded-full bg-accent px-3 py-1 text-xs font-medium"
                        role="status"
                      >
                        {handoverStatusLabels[report.status]}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {report ? (
                    <HandoverDetails report={report} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {owner
                        ? "Заполните осмотр, опись и фотографии. Сохраните черновик и отправьте его арендатору на проверку."
                        : "Собственник ещё не отправил акт на проверку."}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {canEdit && (
                      <Button onClick={edit}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {report ? "Исправить акт" : "Заполнить акт"}
                      </Button>
                    )}
                    {owner && report?.status === "draft" && (
                      <Button onClick={() => openAction("submit")}>
                        <Send className="mr-2 h-4 w-4" />
                        Отправить арендатору
                      </Button>
                    )}
                    {!owner && report?.status === "pending" && (
                      <>
                        <Button onClick={() => openAction("confirm")}>
                          <ClipboardCheck className="mr-2 h-4 w-4" />
                          Подтвердить акт
                        </Button>
                        <Button variant="outline" onClick={() => openAction("dispute")}>
                          Оставить замечания
                        </Button>
                      </>
                    )}
                    {report && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          try {
                            openHandoverReport(report, {
                              property: property?.name ?? "Объект",
                              address: property?.address ?? "",
                              tenant: tenant?.name ?? "Арендатор",
                            });
                          } catch (error) {
                            toast.error((error as Error).message);
                          }
                        }}
                      >
                        <FileDown className="mr-2 h-4 w-4" />
                        Акт / PDF
                      </Button>
                    )}
                    {owner &&
                      kind === "move_out" &&
                      report?.status === "confirmed" &&
                      !report.completed_at &&
                      agreement.status === "active" && (
                        <Button variant="outline" onClick={() => openAction("complete")}>
                          Завершить аренду
                        </Button>
                      )}
                  </div>
                  {report?.status === "pending" && owner && (
                    <p className="text-sm text-muted-foreground">
                      Ожидаем решения арендатора. До его решения отправленный акт не изменяется.
                    </p>
                  )}
                  {kind === "move_out" && report?.status === "confirmed" && (
                    <div className="space-y-3 border-t pt-4">
                      {(report.completed_at || agreement.status === "completed") && (
                        <p className="flex items-center gap-2 text-sm font-medium text-success">
                          <CheckCircle2 className="h-4 w-4" />
                          Аренда завершена. История и расчёт депозита сохранены.
                        </p>
                      )}
                      {owner && Number(report.refund_due) > 0 && !report.refund_marked_at && (
                        <Button
                          className="h-auto max-w-full whitespace-normal"
                          variant="outline"
                          onClick={() => openAction("mark_refunded")}
                        >
                          Отметить возврат депозита
                        </Button>
                      )}
                      {!owner && report.refund_marked_at && !report.refund_confirmed_at && (
                        <Button
                          className="h-auto max-w-full whitespace-normal"
                          onClick={() => openAction("confirm_refund")}
                        >
                          Подтвердить получение депозита
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              {events.length > 0 && (
                <Card>
                  <CardContent className="p-5">
                    <h2 className="mb-3 font-medium">История согласования</h2>
                    <div className="space-y-3">
                      {events.map((event) => (
                        <details key={event.id} className="rounded-lg border p-3">
                          <summary className="cursor-pointer text-sm">
                            {eventLabels[event.event_type] ?? "Изменение акта"} ·{" "}
                            {formatDateTime(event.created_at)} · версия {event.snapshot.revision}
                          </summary>
                          {event.note && (
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                              {event.note}
                            </p>
                          )}
                          <div className="mt-3 border-t pt-3">
                            <HandoverDetails report={event.snapshot} />
                          </div>
                        </details>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}
      {editing && (
        <HandoverEditor
          key={`${editing.agreementId}-${editing.kind}`}
          agreementId={editing.agreementId}
          kind={editing.kind}
          initial={editing.report}
          deposit={editing.deposit}
          startDate={editing.startDate}
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
              {decision ? actions[decision.action].title : "Действие с актом"}
            </DialogTitle>
            <DialogDescription>
              {decision ? actions[decision.action].description : ""}
            </DialogDescription>
          </DialogHeader>
          {decision?.action === "dispute" && (
            <div className="space-y-2">
              <Label htmlFor="handover-review">Замечания к акту</Label>
              <Textarea
                id="handover-review"
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={act.isPending} onClick={() => setDecision(null)}>
              Отмена
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
