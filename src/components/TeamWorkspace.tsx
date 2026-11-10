import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  agreementStatusLabels,
  formatDate,
  formatDateTime,
  formatMoney,
  requestCategoryLabels,
  requestStatusLabels,
  type RequestStatus,
} from "@/lib/domain";
import { actOnTeamProperty, setTeamResponsible } from "@/lib/team-queries";
import { scrollToSearchRecord } from "@/lib/search-record-queries";
import {
  teamRoleLabels,
  type TeamOverview,
  type TeamResponsibleAssignment,
  type TeamWorkspace as Workspace,
} from "@/lib/team";

function ResponsibleEditor({
  propertyId,
  assignment,
  refresh,
}: {
  propertyId: string;
  assignment: TeamResponsibleAssignment;
  refresh: () => Promise<void>;
}) {
  const current = assignment.membership_id ?? "";
  const [choice, setChoice] = useState<string | null>(null);
  const selected =
    choice === "" || assignment.candidates.some((candidate) => candidate.id === choice)
      ? (choice ?? current)
      : current;
  const save = useMutation({
    mutationFn: (membershipId: string | null) => setTeamResponsible(propertyId, membershipId),
    onSuccess: async () => {
      await refresh();
      setChoice(null);
      toast.success("Ответственный изменён");
    },
    onError: () => {
      setChoice(null);
      void refresh();
    },
  });
  return (
    <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
      <Label htmlFor="team-responsible">Ответственный по объекту</Label>
      <p id="team-responsible-help" className="text-sm text-muted-foreground">
        Выберите собственника или действующего управляющего этого объекта.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id="team-responsible"
          aria-describedby="team-responsible-help"
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          value={selected}
          disabled={save.isPending}
          onChange={(e) => {
            setChoice(e.target.value);
            save.reset();
          }}
        >
          <option value="">Собственник</option>
          {assignment.candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        <Button
          disabled={save.isPending || selected === current}
          onClick={() => save.mutate(selected || null)}
        >
          {save.isPending ? "Сохраняем…" : current ? "Переназначить" : "Назначить"}
        </Button>
      </div>
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      )}
    </div>
  );
}

function RequestCard({
  request,
  workspace,
  editable,
  refresh,
  selected,
}: {
  selected?: boolean;
  request: Workspace["requests"][number];
  workspace: Workspace;
  editable: boolean;
  refresh: () => void;
}) {
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: async (action: "request_status" | "request_comment") => {
      setError("");
      if (action === "request_comment" && !comment.trim()) throw new Error("Введите комментарий");
      if (action === "request_comment")
        return actOnTeamProperty(workspace.property.id, action, {
          request_id: request.id,
          text: comment.trim(),
        });
      return actOnTeamProperty(workspace.property.id, action, {
        request_id: request.id,
        status: status ?? request.status,
        expected_status: request.status,
      });
    },
    onSuccess: (_, action) => {
      if (action === "request_comment") setComment("");
      else setStatus(null);
      toast.success(action === "request_comment" ? "Комментарий добавлен" : "Статус обновлён");
      refresh();
    },
    onError: (e: Error) => {
      setError(e.message);
      refresh();
    },
  });
  const comments = workspace.comments.filter((c) => c.request_id === request.id);
  return (
    <article
      id={`team-request-${request.id}`}
      data-testid="team-request"
      className={`space-y-4 rounded-xl border p-4 ${selected ? "border-primary/50 ring-2 ring-primary/20" : ""}`}
      aria-label={request.title}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="break-words font-medium">{request.title}</h4>
          <p className="text-xs text-muted-foreground">
            {request.tenant_name}
            {request.unit_name ? ` · ${request.unit_name}` : ""} ·{" "}
            {formatDateTime(request.created_at)}
          </p>
        </div>
        <span role="status" className="rounded-full bg-muted px-3 py-1 text-xs">
          {requestStatusLabels[request.status]}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{request.description}</p>
      <p className="text-xs text-muted-foreground">{requestCategoryLabels[request.category]}</p>
      {request.category === "repair" && (
        <Button asChild variant="outline" size="sm">
          <Link to="/repairs" search={{ property: workspace.property.id, request: request.id }}>
            Ремонт по заявке
          </Link>
        </Button>
      )}
      {editable && (
        <div className="space-y-2">
          <Label htmlFor={`team-status-${request.id}`}>Статус заявки</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              id={`team-status-${request.id}`}
              value={status ?? request.status}
              onChange={(e) => setStatus(e.target.value as RequestStatus)}
              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
            >
              {Object.entries(requestStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={mutation.isPending || status === null || status === request.status}
              onClick={() => mutation.mutate("request_status")}
            >
              Сохранить статус
            </Button>
          </div>
        </div>
      )}
      {comments.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <h5 className="text-sm font-medium">Комментарии</h5>
          {comments.map((item) => (
            <div className="rounded-lg bg-muted/50 p-3" key={item.id}>
              <p className="text-xs text-muted-foreground">
                {item.user_name} · {formatDateTime(item.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p>
            </div>
          ))}
        </div>
      )}
      {editable && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate("request_comment");
          }}
        >
          <Label htmlFor={`team-comment-${request.id}`}>Комментарий к заявке</Label>
          <Textarea
            id={`team-comment-${request.id}`}
            maxLength={4000}
            required
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={mutation.isPending || !comment.trim()}>
            Добавить комментарий
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

export function TeamWorkspace({
  workspace,
  overview,
  refresh,
  selectedRequestId,
}: {
  selectedRequestId?: string | undefined;
  workspace: Workspace;
  overview: TeamOverview;
  refresh: () => Promise<void>;
}) {
  useEffect(() => {
    if (selectedRequestId) scrollToSearchRecord(`team-request-${selectedRequestId}`);
  }, [selectedRequestId]);
  const editable = workspace.property.role !== "viewer";
  const assignment =
    workspace.responsible_assignment ??
    (workspace.property.role === "owner"
      ? {
          membership_id:
            overview.assignments.find((a) => a.property_id === workspace.property.id)
              ?.membership_id ?? null,
          candidates: overview.members
            .filter(
              (member) =>
                member.owner_id === workspace.property.owner_id &&
                member.status === "active" &&
                member.role === "manager" &&
                member.property_ids.includes(workspace.property.id),
            )
            .map((member) => ({ id: member.id, name: member.name || member.email })),
        }
      : null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const saveNote = useMutation({
    mutationFn: async () => {
      setError("");
      if (!note.trim()) throw new Error("Введите заметку");
      return actOnTeamProperty(workspace.property.id, "note", { text: note.trim() });
    },
    onSuccess: () => {
      setNote("");
      toast.success("Заметка сохранена");
      refresh();
    },
    onError: (e: Error) => {
      setError(e.message);
      refresh();
    },
  });
  return (
    <div className="space-y-5" data-testid="team-workspace">
      <Card>
        <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="break-words">{workspace.property.name}</CardTitle>
            <p className="break-words text-sm text-muted-foreground">
              {workspace.property.address}
            </p>
          </div>
          {workspace.property.role === "owner" && (
            <Button asChild variant="outline" size="sm" className="w-fit shrink-0">
              <Link to="/agreements" search={{ newForProperty: workspace.property.id }}>
                Добавить арендатора
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <p>
              Ваша роль: <strong>{teamRoleLabels[workspace.property.role]}</strong>
            </p>
            <p>Собственник: {workspace.property.owner_name}</p>
            <p>
              Ответственный: {workspace.property.responsible_name || workspace.property.owner_name}
            </p>
          </div>
          {workspace.property.description && (
            <p className="whitespace-pre-wrap break-words text-sm">
              {workspace.property.description}
            </p>
          )}
          {editable && assignment && (
            <ResponsibleEditor
              key={workspace.property.id}
              propertyId={workspace.property.id}
              assignment={assignment}
              refresh={refresh}
            />
          )}
          {!editable && (
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              У вас доступ для просмотра. Изменять заявки и добавлять заметки может управляющий.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Помещения</CardTitle>
        </CardHeader>
        <CardContent>
          {!workspace.units.length ? (
            <p className="text-sm text-muted-foreground">Отдельные помещения не заведены.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {workspace.units.map((unit) => (
                <div className="rounded-lg border p-3" key={unit.id}>
                  <p className="break-words font-medium">{unit.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {unit.area == null ? "Площадь не указана" : `${unit.area} м²`} ·{" "}
                    {unit.status === "occupied"
                      ? "Занято"
                      : unit.status === "available" || unit.status === "vacant"
                        ? "Свободно"
                        : unit.status === "maintenance"
                          ? "На обслуживании"
                          : unit.status}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Аренда по объекту</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Краткие условия для работы команды. Изменения договора и расчёты ведёт собственник.
          </p>
          {!workspace.agreements.length && (
            <p className="text-sm text-muted-foreground">Договоров по объекту пока нет.</p>
          )}
          {workspace.agreements.map((agreement) => (
            <div className="rounded-lg border p-3" key={agreement.id}>
              <p className="break-words font-medium">
                {agreement.tenant_name}
                {agreement.unit_name ? ` · ${agreement.unit_name}` : ""}
              </p>
              <p className="text-sm">
                {formatDate(agreement.start_date)} — {formatDate(agreement.end_date)}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatMoney(agreement.monthly_payment)}/мес. ·{" "}
                {agreementStatusLabels[agreement.status]}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Заметки по объекту</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {editable && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveNote.mutate();
              }}
            >
              <Label htmlFor="team-note">Новая заметка</Label>
              <Textarea
                id="team-note"
                maxLength={2000}
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button disabled={saveNote.isPending || !note.trim()} type="submit">
                Сохранить заметку
              </Button>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </form>
          )}
          {workspace.notes_truncated && (
            <p className="text-xs text-muted-foreground">Показаны последние 50 заметок.</p>
          )}
          {!workspace.notes.length && (
            <p className="text-sm text-muted-foreground">Заметок пока нет.</p>
          )}
          {workspace.notes.map((item) => (
            <div className="rounded-lg bg-muted/50 p-3" key={item.id}>
              <p className="text-xs text-muted-foreground">
                {item.actor_name} · {formatDateTime(item.created_at)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Заявки по объекту</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {workspace.requests_truncated && (
            <p className="text-xs text-muted-foreground">
              Показаны последние 200 заявок по объекту.
            </p>
          )}
          {workspace.comments_truncated && (
            <p className="text-xs text-muted-foreground">
              Показаны последние 500 комментариев. Более ранние комментарии доступны собственнику в
              разделе заявок.
            </p>
          )}
          {!workspace.requests.length && (
            <p className="text-sm text-muted-foreground">Заявок пока нет.</p>
          )}
          {workspace.requests.map((request) => (
            <RequestCard
              selected={request.id === selectedRequestId}
              key={request.id}
              request={request}
              workspace={workspace}
              editable={editable}
              refresh={refresh}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
