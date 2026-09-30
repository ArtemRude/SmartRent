import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, LifeBuoy, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { SupportRequestForm } from "@/components/SupportRequestForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDateTime } from "@/lib/domain";
import {
  supportCategoryLabels,
  supportStatusLabels,
  type SupportRequest,
  type SupportStatus,
} from "@/lib/support";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/support")({
  head: () => ({
    meta: [
      { title: "Поддержка — SmartRent" },
      {
        name: "description",
        content: "Обращения в поддержку SmartRent и история ответов.",
      },
    ],
  }),
  component: SupportPage,
});

async function fetchSupportRequests() {
  const { data, error } = await supabase
    .from("support_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

function StatusBadge({ status }: { status: SupportStatus }) {
  const Icon = status === "resolved" ? CheckCircle2 : status === "in_progress" ? Clock3 : LifeBuoy;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5",
        status === "new" && "border-primary/30 bg-primary/5 text-primary",
        status === "in_progress" && "border-amber-300 bg-amber-50 text-amber-800",
        status === "resolved" && "border-emerald-300 bg-emerald-50 text-emerald-800",
      )}
    >
      <Icon className="h-3 w-3" />
      {supportStatusLabels[status]}
    </Badge>
  );
}

function SupportRequestCard({ request, isAdmin }: { request: SupportRequest; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SupportStatus>(request.status);
  const [response, setResponse] = useState(request.admin_response ?? "");

  const updateRequest = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("support_requests")
        .update({
          status,
          admin_response: response.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id)
        .select("id")
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error("Обращение не было обновлено.");
    },
    onSuccess: () => {
      toast.success("Ответ поддержки сохранён");
      void queryClient.invalidateQueries({ queryKey: ["support-requests"] });
    },
    onError: () => toast.error("Не удалось обновить обращение."),
  });

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{supportCategoryLabels[request.category]}</p>
              <StatusBadge status={request.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDateTime(request.created_at)}
              {isAdmin ? ` · ${request.requester_name} · ${request.requester_email}` : ""}
            </p>
          </div>
          {isAdmin && (
            <Badge variant="secondary">
              {request.source === "landing" ? "С лендинга" : "Из кабинета"}
            </Badge>
          )}
        </div>

        <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{request.message}</p>

        {!isAdmin && request.admin_response && (
          <div className="mt-5 rounded-xl border border-primary/15 bg-primary/[0.035] p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquareText className="h-4 w-4 text-primary" /> Ответ поддержки
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {request.admin_response}
            </p>
          </div>
        )}

        {isAdmin && (
          <div className="mt-5 grid gap-4 border-t pt-5 lg:grid-cols-[200px_1fr_auto] lg:items-end">
            <div className="space-y-2">
              <Label>Статус</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as SupportStatus)}>
                <SelectTrigger aria-label="Статус обращения">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(supportStatusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`support-response-${request.id}`}>Ответ пользователю</Label>
              <Textarea
                id={`support-response-${request.id}`}
                value={response}
                onChange={(event) => setResponse(event.target.value)}
                maxLength={4000}
                rows={3}
                placeholder="Напишите ответ или внутренний результат обработки"
              />
            </div>
            <Button onClick={() => updateRequest.mutate()} disabled={updateRequest.isPending}>
              Сохранить
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SupportPage() {
  const { user, profile, role } = useAuth();
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ["support-requests", user?.id, role],
    queryFn: fetchSupportRequests,
    enabled: Boolean(user),
  });
  const isAdmin = role === "admin";

  return (
    <>
      <PageHeader
        title="Поддержка"
        description={
          isAdmin
            ? "Обращения пользователей с сайта и из личных кабинетов"
            : "Задайте вопрос и следите за ответом в своём кабинете"
        }
      />

      {!isAdmin && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg">Новое обращение</CardTitle>
          </CardHeader>
          <CardContent>
            <SupportRequestForm
              source="account"
              userId={user?.id ?? null}
              defaultName={profile?.name ?? ""}
              defaultEmail={profile?.email ?? user?.email ?? ""}
              onSubmitted={() =>
                void queryClient.invalidateQueries({ queryKey: ["support-requests"] })
              }
            />
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{isAdmin ? "Все обращения" : "Мои обращения"}</h2>
        {requests.data && (
          <span className="text-sm text-muted-foreground">{requests.data.length}</span>
        )}
      </div>

      {requests.isPending && <p className="text-sm text-muted-foreground">Загружаем обращения…</p>}
      {requests.isError && (
        <Card className="border-destructive/20">
          <CardContent className="p-6 text-sm text-destructive">
            Не удалось загрузить обращения. Попробуйте обновить страницу позже.
          </CardContent>
        </Card>
      )}
      <div className="space-y-4">
        {(requests.data ?? []).map((request) => (
          <SupportRequestCard key={request.id} request={request} isAdmin={isAdmin} />
        ))}
      </div>
      {!requests.isPending && !requests.isError && requests.data?.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <LifeBuoy className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Обращений пока нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? "Новые сообщения с сайта и из кабинетов появятся здесь."
                : "После отправки вы увидите здесь статус и ответ поддержки."}
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
