import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, RefreshCw, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { TeamMemberEditor, type CreatedTeamInvitation } from "@/components/TeamMemberEditor";
import { TeamWorkspace } from "@/components/TeamWorkspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/auth-context";
import { formatDateTime, requestStatusLabels, type RequestStatus } from "@/lib/domain";
import {
  acceptTeamInvitation,
  fetchTeamOverview,
  fetchTeamWorkspace,
  manageTeamMember,
  TeamApiError,
} from "@/lib/team-queries";
import {
  TEAM_INVITE_STORAGE_KEY,
  teamEventLabel,
  teamMemberStatus,
  teamRoleLabels,
  type TeamEvent,
  type TeamMember,
} from "@/lib/team";
import { invitationTokenFromHash } from "@/lib/team-invitation";

export const Route = createFileRoute("/_authenticated/team")({
  validateSearch: (search: Record<string, unknown>): { property?: string } =>
    typeof search["property"] === "string" ? { property: search["property"] } : {},
  head: () => ({ meta: [{ title: "Команда — SmartRent" }] }),
  component: TeamPage,
});

function EventDetail({ event }: { event: TeamEvent }) {
  const detail = event.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const status = (value: unknown) =>
    typeof value === "string" ? (requestStatusLabels[value as RequestStatus] ?? value) : "";
  return (
    <div className="space-y-1 break-words text-sm text-muted-foreground">
      {typeof detail["email"] === "string" && <p>{detail["email"]}</p>}
      {typeof detail["role"] === "string" && (
        <p>Роль: {detail["role"] === "manager" ? teamRoleLabels.manager : teamRoleLabels.viewer}</p>
      )}
      {Array.isArray(detail["property_names"]) && (
        <p>
          Объекты:{" "}
          {detail["property_names"]
            .filter((value): value is string => typeof value === "string")
            .join(", ")}
        </p>
      )}
      {"name" in detail && (
        <p>Ответственный: {typeof detail["name"] === "string" ? detail["name"] : "Собственник"}</p>
      )}
      {typeof detail["title"] === "string" && <p>{detail["title"]}</p>}
      {typeof detail["from"] === "string" && typeof detail["to"] === "string" && (
        <p>
          {status(detail["from"])} → {status(detail["to"])}
        </p>
      )}
      {typeof detail["text"] === "string" && (
        <p className="whitespace-pre-wrap">{detail["text"]}</p>
      )}
    </div>
  );
}

function TeamPage() {
  const { user, profile } = useAuth();
  const search = Route.useSearch(),
    navigate = Route.useNavigate(),
    qc = useQueryClient();
  const [editing, setEditing] = useState<{ member: TeamMember | null } | null>(null);
  const [revoking, setRevoking] = useState<TeamMember | null>(null);
  const [invitation, setInvitation] = useState<CreatedTeamInvitation | null>(null);
  const [copyFallback, setCopyFallback] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [storageError, setStorageError] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [revokeError, setRevokeError] = useState("");
  const [workspaceFailure, setWorkspaceFailure] = useState<{
    propertyId: string;
    error: Error;
  } | null>(null);
  useEffect(() => {
    try {
      // The public join route captures the fragment before sign-in. Also support direct team links.
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = invitationTokenFromHash(window.location.hash);
      if (fragment.has("invite")) {
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + window.location.search,
        );
      }
      if (token) sessionStorage.setItem(TEAM_INVITE_STORAGE_KEY, token);
      const stored = sessionStorage.getItem(TEAM_INVITE_STORAGE_KEY);
      if (stored && !/^[0-9a-f]{64}$/.test(stored))
        sessionStorage.removeItem(TEAM_INVITE_STORAGE_KEY);
      setPendingToken(stored && /^[0-9a-f]{64}$/.test(stored) ? stored : null);
    } catch {
      setStorageError(
        "Браузер не смог сохранить приглашение. Разрешите хранилище сайта и откройте ссылку ещё раз.",
      );
    }
  }, []);
  const overviewQuery = useQuery({
    queryKey: ["team-overview", user?.id],
    queryFn: ({ signal }) => fetchTeamOverview(signal),
    enabled: Boolean(user),
    refetchInterval: 5000,
    retry: false,
  });
  // Never render an old permission snapshot after a failed refresh.
  const overview = overviewQuery.isError ? null : overviewQuery.data?.overview;
  const propertyId = search.property ?? overview?.workspaces[0]?.id;
  const selectedSummary = overview?.workspaces.find((property) => property.id === propertyId);
  const permitted = Boolean(selectedSummary);
  const workspaceQuery = useQuery({
    queryKey: ["team-workspace", user?.id, propertyId],
    queryFn: ({ signal }) => fetchTeamWorkspace(propertyId!, signal),
    enabled: Boolean(
      user && propertyId && permitted && workspaceFailure?.propertyId !== propertyId,
    ),
    refetchInterval: 5000,
    retry: false,
  });
  useEffect(() => {
    if (overviewQuery.isError || overviewQuery.isSuccess) {
      const allowed = new Set(overview?.workspaces.map((property) => property.id) ?? []);
      qc.removeQueries({
        queryKey: ["team-workspace", user?.id],
        predicate: (query) => overviewQuery.isError || !allowed.has(String(query.queryKey[2])),
      });
    }
    if (propertyId && workspaceQuery.isError) {
      setWorkspaceFailure({ propertyId, error: workspaceQuery.error });
      qc.removeQueries({ queryKey: ["team-workspace", user?.id, propertyId], exact: true });
    }
  }, [
    propertyId,
    permitted,
    overviewQuery.isSuccess,
    overviewQuery.isError,
    workspaceQuery.isError,
    workspaceQuery.error,
    overview,
    qc,
    user?.id,
  ]);
  const refresh = () => {
    setWorkspaceFailure(null);
    for (const key of [
      "team-overview",
      "team-workspace",
      "requests",
      "request-comments",
      "notifications",
      "property-timeline",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const accept = useMutation({
    mutationFn: async () => {
      setInvitationError("");
      if (!pendingToken) throw new Error("Приглашение не найдено");
      return acceptTeamInvitation(pendingToken);
    },
    onSuccess: () => {
      try {
        sessionStorage.removeItem(TEAM_INVITE_STORAGE_KEY);
      } catch {
        /* The accepted token cannot be reused to grant another account access. */
      }
      setPendingToken(null);
      toast.success("Вы присоединились к команде");
      refresh();
    },
    onError: (e: Error) => setInvitationError(e.message),
  });
  const revoke = useMutation({
    mutationFn: async () => {
      if (!revoking) return;
      setRevokeError("");
      await manageTeamMember(revoking, {
        role: revoking.role,
        propertyIds: revoking.property_ids,
        revoke: true,
      });
    },
    onSuccess: () => {
      toast.success("Доступ отозван");
      setRevoking(null);
      refresh();
    },
    onError: (e: Error) => {
      setRevokeError(e.message);
      refresh();
    },
  });
  const ownMembers = overview?.members.filter((m) => m.owner_id === user?.id) ?? [];
  const incoming =
    overview?.members.filter((m) => m.owner_id !== user?.id && m.user_id === user?.id) ?? [];
  const inviteLink = invitation
    ? `${window.location.origin}/join-team#invite=${encodeURIComponent(invitation.token)}`
    : "";
  const workspaceError =
    workspaceFailure && workspaceFailure.propertyId === propertyId
      ? workspaceFailure.error
      : workspaceQuery.error;
  return (
    <>
      <PageHeader
        title="Команда"
        description="Совместная работа по объектам, ответственные и история действий"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={overviewQuery.isFetching || workspaceQuery.isFetching}
              onClick={() => {
                setWorkspaceFailure(null);
                void overviewQuery.refetch();
                if (permitted) void workspaceQuery.refetch();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
            {Boolean(overview?.properties.length) && (
              <Button onClick={() => setEditing({ member: null })}>
                <Plus className="mr-2 h-4 w-4" />
                Пригласить
              </Button>
            )}
          </div>
        }
      />
      <div className="space-y-5">
        {storageError && (
          <p role="alert" className="text-sm text-destructive">
            {storageError}
          </p>
        )}
        {pendingToken && (
          <Card>
            <CardHeader>
              <CardTitle>Вас пригласили в команду</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Сейчас вы вошли как {profile?.email || user?.email}. Принять приглашение можно
                только с email, который указал собственник.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
                  {accept.isPending ? "Принимаем…" : "Принять приглашение"}
                </Button>
                <Button
                  variant="outline"
                  disabled={accept.isPending}
                  onClick={() => {
                    try {
                      sessionStorage.removeItem(TEAM_INVITE_STORAGE_KEY);
                    } catch {
                      /* Clear the current view even if storage is blocked. */
                    }
                    setPendingToken(null);
                    setInvitationError("");
                  }}
                >
                  Убрать приглашение
                </Button>
              </div>
              {invitationError && (
                <p role="alert" className="text-sm text-destructive">
                  {invitationError}
                </p>
              )}
            </CardContent>
          </Card>
        )}
        {overviewQuery.isPending && (
          <p className="text-sm text-muted-foreground">Загружаем команду и доступные объекты…</p>
        )}
        {overviewQuery.isError && (
          <p role="alert" className="text-sm text-destructive">
            Не удалось обновить сведения команды: {overviewQuery.error.message}. Нажмите «Обновить».
          </p>
        )}
        {overviewQuery.data?.available === false && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Раздел команды пока недоступен. Попробуйте открыть его позже.
            </CardContent>
          </Card>
        )}
        {overview && (
          <>
            {(overview.properties.length > 0 || ownMembers.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>Моя команда</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Приглашайте сотрудников к своим объектам. Роли команды не меняют личную роль в
                    кабинете.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!ownMembers.length && (
                    <div className="rounded-xl border border-dashed p-5 text-center">
                      <UsersRound className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Сотрудников пока нет. Создайте приглашение и передайте ссылку коллеге.
                      </p>
                    </div>
                  )}
                  {ownMembers.map((member) => (
                    <article
                      key={member.id}
                      className="space-y-3 rounded-xl border p-4"
                      aria-label={`Участник ${member.email}`}
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="break-words font-medium">{member.name || member.email}</h3>
                          {member.name && (
                            <p className="break-all text-sm text-muted-foreground">
                              {member.email}
                            </p>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {teamMemberStatus(member)}
                        </span>
                      </div>
                      <p className="text-sm">
                        {teamRoleLabels[member.role]} ·{" "}
                        {member.property_ids
                          .map(
                            (id) =>
                              overview.properties.find((p) => p.id === id)?.name ??
                              "Недоступный объект",
                          )
                          .join(", ") || "Нет объектов"}
                      </p>
                      {member.status === "invited" && (
                        <p className="text-xs text-muted-foreground">
                          Срок приглашения: {formatDateTime(member.expires_at)}. Чтобы получить
                          новую ссылку, пригласите этот email повторно.
                        </p>
                      )}
                      {member.status !== "revoked" && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing({ member })}
                          >
                            Изменить доступ
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRevokeError("");
                              setRevoking(member);
                            }}
                          >
                            Отозвать доступ
                          </Button>
                        </div>
                      )}
                    </article>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Управляющий ведёт заявки, ремонты и отбор кандидатов, видит их контакты и
                    назначает показы. Наблюдатель просматривает общие сведения без контактов
                    кандидатов. Публикацией, выбором арендатора, договорами и доступами управляет
                    собственник.
                  </p>
                </CardContent>
              </Card>
            )}
            {incoming.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Моё участие в других командах</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {incoming.map((member) => (
                    <div key={member.id} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">Команда: {member.owner_name}</p>
                      <p className="text-muted-foreground">
                        {teamRoleLabels[member.role]} · {teamMemberStatus(member)}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Доступные объекты</CardTitle>
                <Button asChild variant="outline" className="w-fit">
                  <Link to="/portfolio">Открыть витрину объектов</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {!overview.workspaces.length && (
                  <p className="text-sm text-muted-foreground">
                    Нет доступных объектов. Собственник может пригласить вас в команду по email.
                  </p>
                )}
                {overview.workspaces.length > 0 && (
                  <>
                    {permitted && propertyId && (
                      <Button asChild variant="outline">
                        <Link to="/objects/$propertyId" params={{ propertyId }}>
                          Открыть страницу объекта
                        </Link>
                      </Button>
                    )}
                    <Label htmlFor="team-property">Объект для совместной работы</Label>
                    <select
                      id="team-property"
                      className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                      value={permitted ? propertyId : ""}
                      onChange={(e) => void navigate({ search: { property: e.target.value } })}
                    >
                      {!permitted && (
                        <option value="" disabled>
                          Выбранный объект недоступен
                        </option>
                      )}
                      {overview.workspaces.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name} · {teamRoleLabels[property.role]} · {property.owner_name}
                        </option>
                      ))}
                    </select>
                    {overview.workspaces
                      .filter((p) => p.id === propertyId)
                      .map((p) => (
                        <p className="text-sm text-muted-foreground" key={p.id}>
                          Помещений: {p.unit_count} · Активных договоров: {p.active_agreements} ·
                          Открытых заявок: {p.open_requests}
                        </p>
                      ))}
                  </>
                )}
              </CardContent>
            </Card>
            {search.property && !permitted && (
              <p role="alert" className="text-sm text-destructive">
                Выбранный объект недоступен: доступ мог быть отозван. Выберите другой объект из
                списка.
              </p>
            )}
            {permitted && !workspaceError && workspaceQuery.isPending && (
              <p className="text-sm text-muted-foreground">Загружаем сведения объекта…</p>
            )}
            {permitted && workspaceError && (
              <p role="alert" className="text-sm text-destructive">
                {workspaceError instanceof TeamApiError && workspaceError.code === "PGRST202"
                  ? "Рабочая область пока недоступна. Попробуйте открыть раздел позже."
                  : `Сведения объекта недоступны: ${workspaceError.message}. Нажмите «Обновить».`}
              </p>
            )}
            {selectedSummary && !workspaceError && workspaceQuery.data && (
              <TeamWorkspace
                key={`${workspaceQuery.data.property.id}:${selectedSummary.role}`}
                workspace={{
                  ...workspaceQuery.data,
                  property: { ...workspaceQuery.data.property, role: selectedSummary.role },
                }}
                overview={overview}
                refresh={refresh}
              />
            )}
            {(overview.properties.length > 0 || overview.events.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>Журнал моей команды</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {overview.events_truncated
                      ? "Последние 100 действий по вашим объектам и доступам."
                      : "Действия по вашим объектам и доступам."}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!overview.events.length && (
                    <p className="text-sm text-muted-foreground">Действий пока нет.</p>
                  )}
                  {overview.events.map((event) => (
                    <article key={event.id} className="space-y-1 rounded-lg border p-3">
                      <p className="font-medium">{teamEventLabel(event.action)}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.actor_name} · {formatDateTime(event.created_at)}
                        {event.property_id
                          ? ` · ${overview.properties.find((p) => p.id === event.property_id)?.name ?? "Объект"}`
                          : ""}
                      </p>
                      <EventDetail event={event} />
                    </article>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
      {editing && overview && (
        <TeamMemberEditor
          member={editing.member}
          properties={overview.properties}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            if (created) {
              setInvitation(created);
              setCopyFallback(false);
            }
            refresh();
          }}
        />
      )}
      {invitation && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setInvitation(null);
          }}
        >
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Передайте ссылку сотруднику</DialogTitle>
              <DialogDescription>
                Письмо не отправляется. Скопируйте ссылку и отправьте её сотруднику самостоятельно.
                Принять её сможет только приглашённый email.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Label htmlFor="team-invitation-link">Ссылка приглашения</Label>
              <Input
                id="team-invitation-link"
                readOnly
                value={inviteLink}
                onFocus={(e) => e.target.select()}
              />
              <p className="text-xs text-muted-foreground">
                Действует до {formatDateTime(invitation.expires_at)}. Ссылка показывается после
                создания; при потере создайте приглашение повторно.
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                    toast.success("Ссылка скопирована");
                  } catch {
                    setCopyFallback(true);
                  }
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Скопировать ссылку
              </Button>
              {copyFallback && (
                <p role="status" className="text-sm text-muted-foreground">
                  Не удалось скопировать автоматически. Выделите ссылку в поле и скопируйте вручную.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setInvitation(null)}>Готово</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {revoking && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !revoke.isPending) setRevoking(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Отозвать доступ?</DialogTitle>
              <DialogDescription>
                Участник {revoking.email} потеряет доступ ко всем вашим объектам. Если он назначен
                ответственным, ответственность вернётся собственнику.
              </DialogDescription>
            </DialogHeader>
            {revokeError && (
              <p role="alert" className="text-sm text-destructive">
                {revokeError}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={revoke.isPending}
                onClick={() => setRevoking(null)}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate()}
              >
                {revoke.isPending ? "Отзываем…" : "Отозвать доступ"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
