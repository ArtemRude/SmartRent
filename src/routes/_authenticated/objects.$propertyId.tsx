import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ListingEditor } from "@/components/ListingEditor";
import { ListingPhoto } from "@/components/ListingPhoto";
import { RentalApplicationCard } from "@/components/RentalApplicationCard";
import { fetchPropertyHub, actOnListing, RecruitmentError } from "@/lib/recruitment-queries";
import {
  listingLabels,
  listingUrl,
  openApplication,
  type PropertyListing,
} from "@/lib/recruitment";
import { repairStatusLabels } from "@/lib/repairs";
import { teamRoleLabels } from "@/lib/team";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  requestStatusLabels,
  agreementStatusLabels,
} from "@/lib/domain";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/auth-context";
export const Route = createFileRoute("/_authenticated/objects/$propertyId")({
  component: PropertyHubPage,
});
function PropertyHubPage() {
  const { propertyId } = Route.useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState<{ listing: PropertyListing | null } | null>(null);
  const [publishing, setPublishing] = useState<PropertyListing | null>(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const query = useQuery({
    queryKey: ["property-hub", user?.id, propertyId],
    queryFn: ({ signal }) => fetchPropertyHub(propertyId, signal),
    enabled: Boolean(user),
    refetchInterval: 5000,
    retry: false,
  });
  const refresh = () => {
    for (const key of [
      "property-catalog",
      "property-hub",
      "recruitment",
      "public-listing",
      "agreements",
      "tenants",
      "team-overview",
      "team-workspace",
    ])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const action = useMutation({
    mutationFn: ({ l, action }: { l: PropertyListing; action: string }) =>
      actOnListing(l.id, action, l.revision),
    onSuccess: () => {
      toast.success(publishing ? "Карточка опубликована" : "Карточка снята с публикации");
      setPublishing(null);
      setError("");
      refresh();
    },
    onError: (e: Error) => {
      setError(e.message);
      refresh();
    },
  });
  const hub = !query.isError ? query.data : undefined;
  const owner = hub?.property.role === "owner";
  const canRecruit = owner || hub?.property.role === "manager";
  return (
    <>
      <PageHeader
        title={hub?.property.name ?? "Страница объекта"}
        description={
          hub
            ? `${hub.property.address} · ${teamRoleLabels[hub.property.role]}`
            : "Заявки, обслуживание и поиск арендатора"
        }
        action={
          <Button variant="outline" onClick={() => void query.refetch()}>
            Обновить
          </Button>
        }
      />
      {query.isPending && <p className="text-sm text-muted-foreground">Загружаем объект…</p>}
      {query.isError && (
        <Card>
          <CardContent className="p-6">
            <p role="alert">
              {query.error instanceof RecruitmentError && query.error.code === "PGRST202"
                ? "Страница объекта пока недоступна. Требуется обновление базы данных."
                : query.error.message}
            </p>
            <Button asChild variant="link">
              <Link to="/team">Доступные объекты в команде</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {hub && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {hub.workspace && (
              <Button asChild variant="outline">
                <Link to="/team" search={{ property: propertyId }}>
                  Рабочая область команды
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to="/repairs" search={{ property: propertyId, request: "" }}>
                Ремонты и подрядчики
              </Link>
            </Button>
            {owner && (
              <>
                <Button asChild variant="outline">
                  <Link to="/properties/$propertyId" params={{ propertyId }}>
                    Параметры объекта
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/finances" search={{ property: propertyId }}>
                    Расходы и прибыль
                  </Link>
                </Button>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Открытые заявки", hub.open_requests],
              ["Работы в процессе", hub.repair_count],
              ["Кандидаты в работе", hub.application_count],
              ["Предстоящие показы", hub.showing_count],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-semibold">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="overview">Обзор и работы</TabsTrigger>
              <TabsTrigger value="publication">Публичные карточки</TabsTrigger>
              <TabsTrigger value="candidates">Кандидаты и показы</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>Сведения для команды</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {hub.property.description || "Внутреннее описание пока не заполнено."}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Ответственный: {hub.workspace?.property.responsible_name || "Собственник"}. Эти
                    сведения доступны только участникам с доступом к объекту.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {hub.units.map((u) => (
                      <div key={u.id} className="rounded-lg border p-3 text-sm">
                        <p className="font-medium">{u.name}</p>
                        <p>
                          {u.area == null ? "Площадь не указана" : `${u.area} м²`} ·{" "}
                          {u.status === "occupied"
                            ? "Занято"
                            : u.status === "available" || u.status === "vacant"
                              ? "Свободно"
                              : "На обслуживании"}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Ремонты и обслуживание</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!hub.repairs.length && (
                    <p className="text-sm text-muted-foreground">
                      Работ пока нет. Добавьте работу в разделе ремонтов или создайте её из заявки.
                    </p>
                  )}
                  {hub.repairs.map((j) => (
                    <div key={j.id} className="rounded-lg border p-3">
                      <p className="font-medium">{j.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {repairStatusLabels[j.status]} · до {formatDate(j.due_date)}
                      </p>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Здесь последние 20 работ. Сметы, исполнители, фотографии и полная история — в
                    разделе ремонтов.
                  </p>
                </CardContent>
              </Card>
              {hub.workspace && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Заявки по объекту</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!hub.workspace.requests.length && (
                        <p className="text-sm text-muted-foreground">
                          Открытых обращений пока нет.
                        </p>
                      )}
                      {hub.workspace.requests.slice(0, 8).map((r) => (
                        <div className="rounded-lg border p-3" key={r.id}>
                          <p className="font-medium">{r.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {requestStatusLabels[r.status]} · {r.tenant_name}
                          </p>
                          <p className="whitespace-pre-wrap break-words text-sm">{r.description}</p>
                        </div>
                      ))}
                      <Button asChild variant="outline">
                        <Link to="/team" search={{ property: propertyId }}>
                          Все заявки и комментарии команды
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Аренда</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!hub.workspace.agreements.length && (
                        <p className="text-sm text-muted-foreground">Договоров пока нет.</p>
                      )}
                      {hub.workspace.agreements.map((a) => (
                        <div key={a.id} className="rounded-lg border p-3 text-sm">
                          <p className="font-medium">
                            {a.tenant_name}
                            {a.unit_name ? ` · ${a.unit_name}` : ""}
                          </p>
                          <p>
                            {formatDate(a.start_date)} — {formatDate(a.end_date)} ·{" "}
                            {agreementStatusLabels[a.status]}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>
            <TabsContent value="publication" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-sm text-muted-foreground">
                  Одна карточка на весь объект или на отдельное помещение. Посетители видят только
                  опубликованные сведения. Сохранение черновика не меняет действующую карточку.
                </p>
                {owner && (
                  <Button onClick={() => setEditing({ listing: null })}>Создать карточку</Button>
                )}
              </div>
              {!hub.listings.length && (
                <Card>
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    Публичных карточек пока нет. Собственник может подготовить и опубликовать
                    предложение аренды.
                  </CardContent>
                </Card>
              )}
              {hub.listings.map((l) => (
                <Card key={l.id}>
                  <CardHeader>
                    <CardTitle>{l.draft.title}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {listingLabels[l.status]} ·{" "}
                      {l.unit_id ? hub.units.find((u) => u.id === l.unit_id)?.name : "Весь объект"}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm">
                      {formatMoney(l.draft.monthly_rent)}/мес. · доступно с{" "}
                      {formatDate(l.draft.available_from)}
                    </p>
                    {l.status === "published" && !l.available && (
                      <p role="status" className="text-sm text-destructive">
                        Карточка скрыта: объект занят, недоступен или уже выбран кандидат. Проверьте
                        договоры и дату доступности.
                      </p>
                    )}
                    {l.has_changes && l.published_snapshot && (
                      <p className="text-sm text-muted-foreground">
                        Есть неопубликованные изменения.
                      </p>
                    )}
                    {owner && (
                      <>
                        <LabelledLink id={l.public_id} />
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={() => setEditing({ listing: l })}>
                            Изменить карточку
                          </Button>
                          {
                            <Button
                              onClick={() => {
                                setError("");
                                setPublishing(l);
                              }}
                            >
                              Опубликовать
                            </Button>
                          }
                          {l.status === "published" && (
                            <Button
                              variant="outline"
                              disabled={action.isPending}
                              onClick={() => {
                                setError("");
                                action.mutate({ l, action: "pause" });
                              }}
                            >
                              Снять с публикации
                            </Button>
                          )}
                          <Button asChild variant="outline">
                            <Link
                              to="/listing/$listingId"
                              params={{ listingId: l.public_id }}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Открыть публичную ссылку
                            </Link>
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              ))}
              {error && !publishing && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </TabsContent>
            <TabsContent value="candidates" className="space-y-4">
              {!canRecruit ? (
                <p className="rounded-xl border p-5 text-sm text-muted-foreground">
                  Контакты кандидатов и управление показами доступны собственнику и управляющим. У
                  вас доступ для просмотра общего состояния.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-muted-foreground">
                      Управляющий назначает показы и ведёт отбор. Собственник выбирает кандидата и
                      создаёт договор.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setAll(!all)}>
                      {all ? "Только в работе" : "Включая завершённые"}
                    </Button>
                  </div>
                  {hub.applications_truncated && (
                    <p className="text-sm text-muted-foreground">
                      Показаны последние 200 откликов.
                    </p>
                  )}
                  {!hub.applications.filter((a) => all || openApplication(a)).length && (
                    <p className="rounded-xl border p-5 text-sm text-muted-foreground">
                      Откликов пока нет. Опубликуйте карточку и передайте ссылку кандидатам.
                    </p>
                  )}
                  {hub.applications
                    .filter((a) => all || openApplication(a))
                    .map((a) => (
                      <RentalApplicationCard
                        key={`${a.id}:${a.revision}`}
                        application={a}
                        operator
                        owner={owner}
                        onSaved={refresh}
                      />
                    ))}
                  {hub.events.length > 0 && (
                    <details className="rounded-xl border p-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        История подбора — последние 50 действий
                      </summary>
                      <div className="mt-3 space-y-2">
                        {hub.events.map((e) => (
                          <p key={e.id} className="text-xs text-muted-foreground">
                            {formatDateTime(e.created_at)} ·{" "}
                            {(
                              {
                                draft_saved: "Черновик сохранён",
                                publish: "Карточка опубликована",
                                pause: "Карточка снята",
                                applied: "Получен отклик",
                                schedule: "Назначен показ",
                                shortlist: "Кандидат в коротком списке",
                                reject: "Отклик отклонён",
                                withdraw: "Отклик отозван",
                                accept: "Кандидат выбран",
                                note: "Сообщение обновлено",
                                undo_selection: "Выбор кандидата отменён",
                              } as Record<string, string>
                            )[e.action] ?? "Изменение"}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
      {editing && hub && owner && (
        <ListingEditor
          hub={hub}
          listing={editing.listing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {publishing && owner && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v && !action.isPending) setPublishing(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Опубликовать карточку?</DialogTitle>
              <DialogDescription>
                Эти сведения и выбранные фотографии появятся в общем каталоге аренды и будут
                доступны любому посетителю по ссылке.
              </DialogDescription>
            </DialogHeader>
            <h3 className="text-xl font-semibold">{publishing.draft.title}</h3>
            <p>{publishing.draft.location}</p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {publishing.draft.description}
            </p>
            <p>
              {formatMoney(publishing.draft.monthly_rent)}/мес. · депозит{" "}
              {formatMoney(publishing.draft.deposit)} · {publishing.draft.area} м²
            </p>
            <p className="text-sm">
              Доступно с {formatDate(publishing.draft.available_from)} ·{" "}
              {publishing.draft.contact_name}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {publishing.draft.photos.map((path, i) => (
                <ListingPhoto key={path} path={path} alt={`Фото для публикации ${i + 1}`} />
              ))}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPublishing(null)}
                disabled={action.isPending}
              >
                Отмена
              </Button>
              <Button
                disabled={action.isPending}
                onClick={() => action.mutate({ l: publishing, action: "publish" })}
              >
                {action.isPending ? "Публикуем…" : "Подтвердить публикацию"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
function LabelledLink({ id }: { id: string }) {
  const url =
    typeof window === "undefined" ? listingUrl(id) : `${window.location.origin}${listingUrl(id)}`;
  return (
    <div className="space-y-2">
      <Input
        aria-label="Публичная ссылка"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast.success("Ссылка скопирована");
          } catch {
            toast.error("Выделите и скопируйте ссылку из поля");
          }
        }}
      >
        Скопировать ссылку
      </Button>
    </div>
  );
}
