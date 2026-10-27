import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, UsersRound, Wrench } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RepairJobEditor, ContractorEditor, repairSelectClass } from "@/components/RepairEditors";
import { RepairDetails } from "@/components/RepairDetails";
import { useAuth } from "@/hooks/auth-context";
import { fetchRepairs } from "@/lib/repair-queries";
import {
  repairStatusLabels,
  repairMoney,
  type RepairJob,
  type RepairContractor,
  type RepairRequest,
  type RepairStatus,
} from "@/lib/repairs";
export const Route = createFileRoute("/_authenticated/repairs")({
  validateSearch: (search: Record<string, unknown>): { property?: string; request?: string } => ({
    ...(typeof search["property"] === "string" ? { property: search["property"] } : {}),
    ...(typeof search["request"] === "string" ? { request: search["request"] } : {}),
  }),
  head: () => ({ meta: [{ title: "Ремонты и подрядчики — SmartRent" }] }),
  component: RepairsPage,
});
function RepairsPage() {
  const { user } = useAuth(),
    qc = useQueryClient(),
    search = Route.useSearch(),
    navigate = Route.useNavigate();
  const query = useQuery({
    queryKey: ["repairs", user?.id],
    queryFn: ({ signal }) => fetchRepairs(signal),
    enabled: Boolean(user),
    refetchInterval: 5000,
    retry: false,
  });
  const data = query.isError ? null : query.data?.overview;
  const writableProperties =
    data?.properties.filter((p) => ["owner", "manager"].includes(p.role)) ?? [];
  const selected = search.property
    ? data?.properties.find((p) => p.id === search.property)
    : (writableProperties.find((p) => p.role === "owner") ??
      writableProperties[0] ??
      data?.properties[0]);
  const [status, setStatus] = useState<RepairStatus | "all">("all"),
    [editor, setEditor] = useState<{
      initial: RepairJob | null;
      request: RepairRequest | null;
    } | null>(null),
    [contractorsOpen, setContractorsOpen] = useState(false),
    [contractorEdit, setContractorEdit] = useState<{ initial: RepairContractor | null } | null>(
      null,
    );
  const refresh = () => {
    for (const key of [
      "repairs",
      "requests",
      "request-status-events",
      "team-workspace",
      "team-overview",
      "property-expenses",
      "property-finances",
      "property-timeline",
      "notifications",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const jobs = (data?.jobs ?? []).filter(
    (j) =>
      (!search.property || j.property_id === search.property) &&
      (!search.request || j.request_id === search.request) &&
      (status === "all" || j.status === status),
  );
  const readyRequest = data?.requests.find(
    (r) => r.id === search.request && (!search.property || r.property_id === search.property),
  );
  const canCreate = search.property
    ? Boolean(selected && ["owner", "manager"].includes(selected.role))
    : writableProperties.length > 0;
  const tenantView = Boolean(
    data?.properties.length && data.properties.every((p) => p.role === "tenant"),
  );
  const chosenJobs = jobs.filter((j) => j.role !== "tenant" && j.status !== "cancelled");
  const planned = chosenJobs.reduce((sum, j) => sum + (j.estimated_total ?? 0), 0),
    actual = chosenJobs
      .filter((j) => j.status === "completed")
      .reduce((sum, j) => sum + (j.actual_amount ?? 0), 0);
  return (
    <>
      <PageHeader
        title={tenantView ? "Ход ремонта" : "Ремонты и подрядчики"}
        description={
          tenantView
            ? "Сроки и результаты работ по вашим обращениям"
            : "Сметы, исполнители, сроки и история обслуживания объектов"
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
            {data && selected?.role === "owner" && (
              <Button variant="outline" onClick={() => setContractorsOpen(true)}>
                <UsersRound className="mr-2 h-4 w-4" />
                Исполнители
              </Button>
            )}
            {data && canCreate && (
              <Button onClick={() => setEditor({ initial: null, request: readyRequest ?? null })}>
                <Plus className="mr-2 h-4 w-4" />
                Новая работа
              </Button>
            )}
          </div>
        }
      />
      {query.isPending && (
        <p className="text-sm text-muted-foreground">Загружаем работы и исполнителей…</p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          Не удалось обновить работы: {query.error.message}. Нажмите «Обновить».
        </p>
      )}
      {query.data?.available === false && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Раздел ремонтов пока недоступен. Попробуйте открыть его позже.
          </CardContent>
        </Card>
      )}
      {data && (
        <div className="space-y-5">
          {search.request && (
            <Card>
              <CardContent className="space-y-3 p-5">
                {readyRequest ? (
                  <>
                    <p className="font-medium">Заявка: {readyRequest.title}</p>
                    <p className="text-sm text-muted-foreground">{readyRequest.description}</p>
                    <Button onClick={() => setEditor({ initial: null, request: readyRequest })}>
                      Создать работу по заявке
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {data.jobs.some((j) => j.request_id === search.request)
                      ? "Показаны работы по выбранной заявке."
                      : "Работа по этой заявке ещё не опубликована или недоступна."}
                  </p>
                )}
                <Button variant="outline" asChild>
                  <Link to="/repairs" search={search.property ? { property: search.property } : {}}>
                    Все работы объекта
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="repairs-property-filter">Объект</Label>
              <select
                id="repairs-property-filter"
                className={repairSelectClass}
                value={search.property ?? ""}
                onChange={(e) =>
                  void navigate({ search: e.target.value ? { property: e.target.value } : {} })
                }
              >
                <option value="">Все доступные объекты</option>
                {data.properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="repairs-status-filter">Состояние работы</Label>
              <select
                id="repairs-status-filter"
                className={repairSelectClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as RepairStatus | "all")}
              >
                <option value="all">Все состояния</option>
                {Object.entries(repairStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {chosenJobs.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <CardContent className="p-5">
                  <p className="text-xs text-muted-foreground">Сметы работ, кроме отменённых</p>
                  <p className="mt-1 text-xl font-semibold">{repairMoney(planned)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-xs text-muted-foreground">Стоимость принятых работ</p>
                  <p className="mt-1 text-xl font-semibold">{repairMoney(actual)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Платежи учитываются отдельно в расходах.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
          {data.jobs_truncated && (
            <p className="text-sm text-muted-foreground">
              Показаны последние 500 работ. Полная история сохранена в базе.
            </p>
          )}
          {data.events_truncated && (
            <p className="text-sm text-muted-foreground">
              История версий ограничена последними 2000 событиями.
            </p>
          )}
          {!jobs.length && (
            <Card>
              <CardContent className="p-8 text-center">
                <Wrench className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 font-medium">Работ по этим условиям пока нет</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {canCreate
                    ? "Оформите работу из заявки или запланируйте обслуживание без неё."
                    : "Здесь появятся доступные вам ремонтные работы после согласования собственником."}
                </p>
              </CardContent>
            </Card>
          )}
          {jobs.map((job) => (
            <RepairDetails
              key={`${job.id}:${job.role}`}
              job={job}
              userId={user!.id}
              events={data.events.filter((e) => e.job_id === job.id)}
              onEdit={() => setEditor({ initial: job, request: null })}
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
      {data && editor && (
        <RepairJobEditor
          overview={data}
          initial={editor.initial}
          request={editor.request}
          propertyId={selected?.id}
          onClose={() => setEditor(null)}
          onSaved={() => {
            if (!editor.initial && !editor.request) void navigate({ search: {} });
            setStatus("all");
            setEditor(null);
            refresh();
          }}
        />
      )}
      {data && contractorsOpen && selected?.role === "owner" && (
        <Dialog open onOpenChange={setContractorsOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Исполнители</DialogTitle>
              <DialogDescription>
                Справочник собственника объекта «{selected.name}». Контакты закрепляются в версии
                сметы.
              </DialogDescription>
            </DialogHeader>
            <Button onClick={() => setContractorEdit({ initial: null })}>
              Добавить исполнителя
            </Button>
            <div className="space-y-3">
              {data.contractors
                .filter((c) => c.owner_id === selected.owner_id)
                .map((c) => (
                  <article key={c.id} className="space-y-2 rounded-xl border p-4">
                    <p className="break-words font-medium">
                      {c.name}
                      {!c.active ? " · Архив" : ""}
                    </p>
                    <p className="break-words text-sm text-muted-foreground">
                      {[c.specialty, c.phone, c.email].filter(Boolean).join(" · ")}
                    </p>
                    {c.note && <p className="whitespace-pre-wrap break-words text-sm">{c.note}</p>}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setContractorEdit({ initial: c })}
                    >
                      Изменить исполнителя {c.name}
                    </Button>
                  </article>
                ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
      {data && contractorEdit && selected?.role === "owner" && (
        <ContractorEditor
          ownerId={selected.owner_id}
          initial={contractorEdit.initial}
          onClose={() => setContractorEdit(null)}
          onSaved={() => {
            setContractorEdit(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
