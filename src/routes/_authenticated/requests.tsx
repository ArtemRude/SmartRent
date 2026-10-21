import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronRight, Clock3, Inbox, MessageCircle, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDateTime,
  requestCategoryLabels,
  requestStatusLabels,
  type RequestCategory,
  type RequestStatus,
} from "@/lib/domain";
import {
  fetchAgreements,
  fetchComments,
  fetchProperties,
  fetchRequests,
  fetchRequestStatusEvents,
  fetchTenants,
  fetchUnits,
  type RequestRow,
} from "@/lib/queries";
import { getSignedUrl, removeFile, REQUEST_PHOTOS, uploadFile } from "@/lib/storage";

export const Route = createFileRoute("/_authenticated/requests")({
  head: () => ({
    meta: [
      { title: "Заявки — SmartRent" },
      {
        name: "description",
        content: "Заявки арендаторов, обсуждение и контроль выполнения.",
      },
    ],
  }),
  component: RequestsPage,
});

type RequestForm = {
  agreementId: string;
  title: string;
  description: string;
  category: RequestCategory;
  photo: File | null;
};

const emptyForm: RequestForm = {
  agreementId: "",
  title: "",
  description: "",
  category: "repair",
  photo: null,
};

type StatusFilter = "all" | RequestStatus;

function RequestsPage() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const requests = useQuery({ queryKey: ["requests"], queryFn: fetchRequests });
  const agreements = useQuery({ queryKey: ["agreements"], queryFn: fetchAgreements });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const units = useQuery({ queryKey: ["units"], queryFn: fetchUnits });
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: fetchTenants });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<RequestForm>(emptyForm);
  const [comment, setComment] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const selectedRequest = requests.data?.find((request) => request.id === selectedId) ?? null;
  const comments = useQuery({
    queryKey: ["request-comments", selectedId],
    queryFn: () => fetchComments(selectedId!),
    enabled: Boolean(selectedId),
  });
  const statusEvents = useQuery({
    queryKey: ["request-status-events", selectedId],
    queryFn: () => fetchRequestStatusEvents(selectedId!),
    enabled: Boolean(selectedId),
  });
  const photoUrl = useQuery({
    queryKey: ["request-photo", selectedRequest?.photo],
    queryFn: () => getSignedUrl(REQUEST_PHOTOS, selectedRequest!.photo!),
    enabled: Boolean(selectedRequest?.photo),
    staleTime: 50 * 60 * 1000,
  });

  const activeAgreements = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return (agreements.data ?? []).filter(
      (agreement) =>
        agreement.status === "active" &&
        agreement.start_date <= today &&
        agreement.end_date >= today,
    );
  }, [agreements.data]);

  const visibleRequests = useMemo(
    () =>
      (requests.data ?? []).filter(
        (request) => statusFilter === "all" || request.status === statusFilter,
      ),
    [requests.data, statusFilter],
  );

  const createRequest = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Нет активной сессии");
      const agreement = activeAgreements.find((item) => item.id === form.agreementId);
      if (!agreement) throw new Error("Выберите активный договор");
      if (!form.title.trim() || !form.description.trim()) {
        throw new Error("Заполните тему и описание заявки");
      }

      let uploadedPath: string | null = null;
      try {
        if (form.photo) uploadedPath = await uploadFile(REQUEST_PHOTOS, user.id, form.photo);
        const { data, error } = await supabase
          .from("requests")
          .insert({
            tenant_id: agreement.tenant_id,
            owner_id: agreement.owner_id,
            property_id: agreement.property_id,
            unit_id: agreement.unit_id,
            title: form.title.trim(),
            description: form.description.trim(),
            category: form.category,
            status: "new",
            photo: uploadedPath,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        return data as RequestRow;
      } catch (error) {
        if (uploadedPath) await removeFile(REQUEST_PHOTOS, uploadedPath).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: (request) => {
      toast.success("Заявка отправлена собственнику");
      setCreateOpen(false);
      setForm(emptyForm);
      setSelectedId(request.id);
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sendComment = useMutation({
    mutationFn: async () => {
      if (!user || !selectedId) throw new Error("Нет активной заявки");
      const text = comment.trim();
      if (!text) throw new Error("Введите сообщение");
      const { error } = await supabase.from("comments").insert({
        request_id: selectedId,
        user_id: user.id,
        text,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setComment("");
      void qc.invalidateQueries({ queryKey: ["request-comments", selectedId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const changeStatus = useMutation({
    mutationFn: async (status: RequestStatus) => {
      if (!selectedId) throw new Error("Нет активной заявки");
      const { error } = await supabase.from("requests").update({ status }).eq("id", selectedId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Статус заявки обновлён");
      void qc.invalidateQueries({ queryKey: ["requests"] });
      void qc.invalidateQueries({ queryKey: ["request-status-events", selectedId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const loading = [requests, agreements, properties, units, tenants].some(
    (query) => query.isPending,
  );
  const failed = [requests, agreements, properties, units, tenants].some((query) => query.isError);
  const canCreate = role === "tenant" && activeAgreements.length > 0;

  const propertyName = (request: RequestRow) =>
    properties.data?.find((property) => property.id === request.property_id)?.name ?? "Объект";
  const unitName = (request: RequestRow) =>
    units.data?.find((unit) => unit.id === request.unit_id)?.name;
  const tenantName = (request: RequestRow) =>
    tenants.data?.find((tenant) => tenant.id === request.tenant_id)?.name ?? "Арендатор";
  const actorName = (actorId: string | null) => {
    if (!actorId) return "Система";
    if (actorId === user?.id) return "Вы";
    if (actorId === selectedRequest?.owner_id) return "Собственник";
    return actorId ===
      tenants.data?.find((tenant) => tenant.id === selectedRequest?.tenant_id)?.user_id
      ? "Арендатор"
      : "Представитель собственника";
  };

  return (
    <>
      <PageHeader
        title="Заявки"
        description={
          role === "tenant"
            ? "Обращения к собственнику и история их выполнения"
            : "Обращения арендаторов, обсуждение и контроль выполнения"
        }
        action={
          role === "tenant" ? (
            <Button onClick={() => setCreateOpen(true)} disabled={!canCreate}>
              <Plus className="mr-2 h-4 w-4" /> Новая заявка
            </Button>
          ) : undefined
        }
      />

      {role === "tenant" && !loading && activeAgreements.length === 0 && (
        <Card className="mb-4">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Создание заявки станет доступно, когда собственник добавит действующий договор.
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {visibleRequests.length} из {requests.data?.length ?? 0}
        </p>
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="new">Новые</SelectItem>
            <SelectItem value="in_progress">В работе</SelectItem>
            <SelectItem value="closed">Закрытые</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Загружаем заявки…</p>}
      {failed && <p className="text-sm text-destructive">Не удалось загрузить данные заявок.</p>}

      {!loading && !failed && visibleRequests.length > 0 && (
        <div className="space-y-3">
          {visibleRequests.map((request) => (
            <Card key={request.id} className="transition-shadow hover:shadow-md">
              <button
                type="button"
                className="flex w-full items-center gap-4 p-5 text-left"
                onClick={() => setSelectedId(request.id)}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                  <Inbox className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{request.title}</span>
                    <StatusBadge status={request.status} />
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {propertyName(request)}
                    {unitName(request) ? ` · ${unitName(request)}` : ""}
                    {role !== "tenant" ? ` · ${tenantName(request)}` : ""}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {requestCategoryLabels[request.category]} · {formatDateTime(request.created_at)}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </button>
            </Card>
          ))}
        </div>
      )}

      {!loading && !failed && visibleRequests.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Заявок здесь пока нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {statusFilter === "all"
                ? "Новые обращения появятся в этом разделе."
                : "Попробуйте выбрать другой статус."}
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новая заявка</DialogTitle>
            <DialogDescription>
              Опишите вопрос — собственник увидит заявку и сможет ответить здесь.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Договор и объект</Label>
              <Select
                value={form.agreementId}
                onValueChange={(agreementId) => setForm((current) => ({ ...current, agreementId }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите договор" />
                </SelectTrigger>
                <SelectContent>
                  {activeAgreements.map((agreement) => {
                    const property = properties.data?.find(
                      (item) => item.id === agreement.property_id,
                    );
                    const unit = units.data?.find((item) => item.id === agreement.unit_id);
                    return (
                      <SelectItem key={agreement.id} value={agreement.id}>
                        {property?.name ?? "Объект"}
                        {unit ? ` · ${unit.name}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Категория</Label>
              <Select
                value={form.category}
                onValueChange={(category) =>
                  setForm((current) => ({ ...current, category: category as RequestCategory }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(requestCategoryLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="request-title">Тема</Label>
              <Input
                id="request-title"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Например, не работает отопление"
                maxLength={160}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="request-description">Описание</Label>
              <Textarea
                id="request-description"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Что произошло, когда вы это заметили и насколько срочно нужна помощь"
                rows={5}
                maxLength={3000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="request-photo" className="flex items-center gap-2">
                <Camera className="h-4 w-4" /> Фото, необязательно
              </Label>
              <Input
                id="request-photo"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(event) =>
                  setForm((current) => ({ ...current, photo: event.target.files?.[0] ?? null }))
                }
              />
              <p className="text-xs text-muted-foreground">JPG, PNG, WebP или GIF до 8 МБ.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => createRequest.mutate()}
              disabled={createRequest.isPending || !form.agreementId}
            >
              {createRequest.isPending ? "Отправляем…" : "Отправить заявку"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setComment("");
          }
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          {selectedRequest && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 pr-6">
                  <DialogTitle>{selectedRequest.title}</DialogTitle>
                  <StatusBadge status={selectedRequest.status} />
                </div>
                <DialogDescription>
                  {propertyName(selectedRequest)}
                  {unitName(selectedRequest) ? ` · ${unitName(selectedRequest)}` : ""}
                  {role !== "tenant" ? ` · ${tenantName(selectedRequest)}` : ""}
                  {` · ${formatDateTime(selectedRequest.created_at)}`}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                <section>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {requestCategoryLabels[selectedRequest.category]}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {selectedRequest.description}
                  </p>
                  {selectedRequest.photo && (
                    <div className="mt-4 overflow-hidden rounded-xl border bg-muted">
                      {photoUrl.isPending && (
                        <div className="grid h-48 place-items-center text-sm text-muted-foreground">
                          Загружаем фото…
                        </div>
                      )}
                      {photoUrl.data && (
                        <img
                          src={photoUrl.data}
                          alt={`Фото к заявке «${selectedRequest.title}»`}
                          className="max-h-96 w-full object-contain"
                        />
                      )}
                      {photoUrl.isError && (
                        <div className="grid h-32 place-items-center text-sm text-destructive">
                          Не удалось открыть фото.
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {role !== "tenant" && (
                  <section className="rounded-xl border p-4">
                    <Label>Статус заявки</Label>
                    <Select
                      value={selectedRequest.status}
                      onValueChange={(status) => changeStatus.mutate(status as RequestStatus)}
                      disabled={changeStatus.isPending}
                    >
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">Новая</SelectItem>
                        <SelectItem value="in_progress">В работе</SelectItem>
                        <SelectItem value="closed">Закрыта</SelectItem>
                      </SelectContent>
                    </Select>
                  </section>
                )}

                <section>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <MessageCircle className="h-4 w-4" /> Обсуждение
                  </h3>
                  <div className="mt-3 space-y-3">
                    {comments.isPending && (
                      <p className="text-sm text-muted-foreground">Загружаем сообщения…</p>
                    )}
                    {(comments.data ?? []).map((item) => {
                      const author = actorName(item.user_id);
                      return (
                        <div key={item.id} className="rounded-xl bg-muted/70 p-3">
                          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{author}</span>
                            <span>{formatDateTime(item.created_at)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm">{item.text}</p>
                        </div>
                      );
                    })}
                    {!comments.isPending && (comments.data?.length ?? 0) === 0 && (
                      <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>
                    )}
                    {comments.isError && (
                      <p className="text-sm text-destructive">Не удалось загрузить обсуждение.</p>
                    )}
                  </div>
                  <div className="mt-3 flex items-end gap-2">
                    <Textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder="Напишите сообщение…"
                      rows={3}
                      maxLength={2000}
                    />
                    <Button
                      size="icon"
                      aria-label="Отправить сообщение"
                      onClick={() => sendComment.mutate()}
                      disabled={sendComment.isPending || !comment.trim()}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </section>

                <section>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Clock3 className="h-4 w-4" /> История статусов
                  </h3>
                  <div className="mt-3 space-y-3 border-l pl-4">
                    {(statusEvents.data ?? []).map((event) => {
                      const actor = actorName(event.changed_by);
                      return (
                        <div key={event.id} className="relative text-sm">
                          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                          <p>
                            {event.from_status == null
                              ? `Заявка создана со статусом «${requestStatusLabels[event.to_status]}»`
                              : `Статус изменён: «${requestStatusLabels[event.from_status]}» → «${requestStatusLabels[event.to_status]}»`}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {actor} · {formatDateTime(event.created_at)}
                          </p>
                        </div>
                      );
                    })}
                    {statusEvents.isPending && (
                      <p className="text-sm text-muted-foreground">Загружаем историю…</p>
                    )}
                    {statusEvents.isError && (
                      <p className="text-sm text-destructive">Не удалось загрузить историю.</p>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
