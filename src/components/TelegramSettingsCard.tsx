import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  ExternalLink,
  History,
  LoaderCircle,
  PauseCircle,
  Send,
  ShieldCheck,
  Unplug,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/auth-context";
import { formatDateTime, notificationKindLabels } from "@/lib/domain";
import {
  beginTelegramLink,
  confirmTelegramLink,
  disconnectTelegram,
  fetchTelegramOverview,
  saveTelegramPreferences,
  telegramQueryKey,
  testTelegramDelivery,
} from "@/lib/telegram-queries";
import {
  telegramBotLink,
  telegramDeliveryExplanation,
  telegramStatusLabels,
  telegramTopics,
  type TelegramDeliveryStatus,
  type TelegramLink,
  type TelegramTopic,
} from "@/lib/telegram";
import { cn } from "@/lib/utils";

const topicDescriptions: Record<TelegramTopic, string> = {
  payments: "Оплаты, сроки и результаты проверки",
  agreements: "Условия аренды, продление и акты",
  requests: "Новые обращения, ответы и статусы",
  repairs: "Работы, согласования и приёмка",
  recruitment: "Отклики и этапы отбора кандидатов",
  utilities: "Показания и коммунальные расчёты",
  objects: "Изменения объекта и заметки команды",
};

const deliveryAppearance: Record<TelegramDeliveryStatus, { icon: typeof Send; className: string }> =
  {
    pending: { icon: Clock3, className: "bg-muted text-muted-foreground" },
    processing: { icon: LoaderCircle, className: "bg-accent text-accent-foreground" },
    retry: { icon: Clock3, className: "bg-warning/15 text-foreground" },
    sent: { icon: CheckCheck, className: "bg-success/10 text-foreground" },
    failed: { icon: XCircle, className: "bg-destructive/10 text-destructive" },
    cancelled: { icon: PauseCircle, className: "bg-muted text-muted-foreground" },
    uncertain: { icon: CircleHelp, className: "bg-warning/15 text-foreground" },
  };

export function TelegramSettingsCard() {
  const { user } = useAuth();
  return user ? <TelegramSettings key={user.id} userId={user.id} /> : null;
}

function TelegramSettings({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const queryKey = telegramQueryKey(userId);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchTelegramOverview(signal),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [now, setNow] = useState(Date.now());
  const [lastTestAt, setLastTestAt] = useState(0);
  const [showAllHistory, setShowAllHistory] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const overview = query.isError ? null : query.data?.overview;
  const refresh = () => qc.invalidateQueries({ queryKey });
  const failed = (error: Error) => {
    toast.error(error.message);
    void refresh();
  };
  const begin = useMutation({
    mutationFn: async () => {
      setLink(await beginTelegramLink());
    },
    onSuccess: () => refresh(),
    onError: failed,
  });
  const confirm = useMutation({
    mutationFn: confirmTelegramLink,
    onSuccess: () => {
      setLink(null);
      toast.success("Telegram подключён");
      return refresh();
    },
    onError: failed,
  });
  const disconnect = useMutation({
    mutationFn: disconnectTelegram,
    onSuccess: () => {
      setLink(null);
      toast.success("Telegram отключён");
      return refresh();
    },
    onError: failed,
  });
  const save = useMutation({
    mutationFn: ({ enabled, topics }: { enabled: boolean; topics: TelegramTopic[] }) =>
      saveTelegramPreferences(enabled, topics),
    onSuccess: () => refresh(),
    onError: failed,
  });
  const sendTest = useMutation({
    mutationFn: testTelegramDelivery,
    onSuccess: () => {
      setLastTestAt(Date.now());
      toast.success("Проверочное сообщение поставлено в очередь");
      return refresh();
    },
    onError: failed,
  });
  const busy =
    begin.isPending ||
    confirm.isPending ||
    disconnect.isPending ||
    save.isPending ||
    sendTest.isPending;
  useEffect(() => {
    if (query.isError || overview?.connection || (link && Date.parse(link.expires_at) <= now))
      setLink(null);
  }, [query.isError, overview?.connection, link, now]);
  const activeLink = link && Date.parse(link.expires_at) > now && !query.isError ? link : null;
  const pending =
    overview?.pending && Date.parse(overview.pending.expires_at) > now ? overview.pending : null;
  const testWait = Math.max(0, Math.ceil((lastTestAt + 60_000 - now) / 1_000));

  const connected = Boolean(overview?.connection);
  const connectionLabel = query.isError
    ? "Недоступно"
    : query.isPending
      ? "Загрузка"
      : !overview?.configured
        ? "Не настроено"
        : connected
          ? overview?.enabled
            ? "Подключён"
            : "Отправка на паузе"
          : pending
            ? "Ждёт подтверждения"
            : "Не подключён";
  const history = showAllHistory ? overview?.deliveries : overview?.deliveries.slice(0, 5);

  return (
    <Card className="mb-6 overflow-hidden" data-testid="telegram-settings">
      <CardContent className="space-y-6 p-4 sm:p-5 md:p-6">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
          <div className="flex w-full min-w-0 items-start gap-3 sm:w-auto sm:flex-1">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground">
              <Send className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Telegram-уведомления</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Важное по объектам и аренде — даже когда кабинет закрыт.
              </p>
            </div>
          </div>
          <span
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
              connected && overview?.configured && overview?.enabled
                ? "bg-success/10 text-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {connected ? (
              <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            )}
            {connectionLabel}
          </span>
        </div>
        {query.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Загружаем настройки Telegram…
          </p>
        )}
        {query.isError && (
          <div role="alert" className="space-y-3 text-sm">
            <p className="text-destructive">
              Настройки Telegram недоступны. Предыдущие сведения скрыты.
            </p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Повторить загрузку
            </Button>
          </div>
        )}
        {!query.isError && query.data?.available === false && (
          <p className="text-sm text-muted-foreground">
            Telegram ещё не подключён к сервису. Подключение появится после настройки
            администратором.
          </p>
        )}
        {overview && !overview.configured && (
          <p className="text-sm text-muted-foreground">
            Доставка Telegram пока не настроена администратором. Подключение станет доступно после
            запуска бота.
          </p>
        )}
        {overview?.configured && (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)] lg:gap-6">
            <div className="min-w-0 space-y-4">
              {overview.connection ? (
                <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Ваш аккаунт
                  </p>
                  <p className="break-words text-sm font-semibold">
                    Подключён:{" "}
                    {overview.connection.username
                      ? `@${overview.connection.username}`
                      : "Telegram-аккаунт без username"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    С {formatDateTime(overview.connection.connected_at)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => disconnect.mutate()}
                  >
                    <Unplug className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    Отключить Telegram
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 rounded-2xl border bg-surface/60 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4 text-accent-foreground" aria-hidden="true" />
                    Подключите личный чат
                  </div>
                  <ol
                    className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
                    aria-label="Шаги подключения"
                  >
                    <li>1. Откройте бота</li>
                    <li>2. Нажмите «Старт»</li>
                    <li>3. Подтвердите здесь</li>
                  </ol>
                  <p className="text-sm text-muted-foreground">
                    Откройте бота, нажмите «Старт», затем вернитесь сюда и подтвердите свой
                    Telegram-аккаунт. Ссылка одноразовая — не передавайте её другим.
                  </p>
                  {activeLink ? (
                    <>
                      <Button asChild className="w-full sm:w-auto">
                        <a
                          href={telegramBotLink(activeLink)}
                          target="_blank"
                          rel="noopener noreferrer"
                          referrerPolicy="no-referrer"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Открыть бота
                        </a>
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Ссылка действует до {formatDateTime(activeLink.expires_at)}. После «Старт»
                        ждём подтверждение от бота.
                      </p>
                      {!pending && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => disconnect.mutate()}
                        >
                          Отменить подключение
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setLink(null);
                        begin.mutate();
                      }}
                    >
                      Подключить Telegram
                    </Button>
                  )}
                  {pending && (
                    <div
                      className="space-y-3 rounded-xl border border-warning/30 bg-warning/10 p-3"
                      role="status"
                    >
                      <p className="break-words text-sm font-medium">
                        Бот получил запрос от{" "}
                        {pending.username ? `@${pending.username}` : "аккаунта без username"}.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Подтверждайте только свой аккаунт. Если запрос чужой, отмените подключение и
                        создайте новую ссылку.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={busy} onClick={() => confirm.mutate(pending.id)}>
                          Подтвердить мой аккаунт
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => disconnect.mutate()}
                        >
                          Отменить подключение
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-4 rounded-2xl border p-4">
                <div>
                  <p className="text-sm font-medium">Отправлять в Telegram</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Только новые события после подключения и включения канала.
                  </p>
                </div>
                <Switch
                  aria-label="Отправлять в Telegram"
                  checked={overview.enabled}
                  disabled={busy || !overview.connection}
                  onCheckedChange={(enabled) => save.mutate({ enabled, topics: overview.topics })}
                />
              </div>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="h-auto min-h-9 w-full whitespace-normal py-2 text-left"
                  disabled={busy || !overview.connection || !overview.enabled || testWait > 0}
                  onClick={() => sendTest.mutate()}
                >
                  <Send className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
                  Отправить проверочное сообщение{testWait > 0 ? ` (${testWait} с)` : ""}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Доставка обычно занимает около минуты. Результат появится в истории ниже.
                </p>
              </div>
            </div>
            <fieldset disabled={busy || !overview.connection} className="min-w-0 space-y-3">
              <legend className="text-sm font-semibold">Темы уведомлений</legend>
              <p className="text-xs text-muted-foreground">
                Выберите нужное. Получатели и доступ к событиям определяются вашей ролью.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.entries(telegramTopics) as [TelegramTopic, string][]).map(
                  ([topic, label]) => (
                    <label
                      key={topic}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-xl border p-3 text-sm transition-colors",
                        overview.topics.includes(topic) && overview.connection
                          ? "border-primary/20 bg-primary/[0.035]"
                          : "bg-card",
                        !overview.connection && "opacity-60",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{label}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          {topicDescriptions[topic]}
                        </span>
                      </span>
                      <Switch
                        aria-label={label}
                        checked={overview.topics.includes(topic)}
                        disabled={busy || !overview.connection}
                        onCheckedChange={(checked) =>
                          save.mutate({
                            enabled: overview.enabled,
                            topics: checked
                              ? [...overview.topics, topic]
                              : overview.topics.filter((item) => item !== topic),
                          })
                        }
                      />
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          </div>
        )}
        {overview && (
          <section aria-label="История отправок Telegram" className="space-y-3 border-t pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                История отправок
              </h3>
              <span className="text-xs text-muted-foreground">Обновляется автоматически</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Статус «Принято Telegram» не означает, что сообщение прочитано.
            </p>
            {overview.deliveries.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4">
                <p className="text-sm font-medium">Отправок пока нет.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  После подключения отправьте проверочное сообщение или дождитесь нового события.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {history?.map((delivery) => {
                  const appearance = deliveryAppearance[delivery.status] ?? {
                    icon: CircleAlert,
                    className: "bg-muted text-muted-foreground",
                  };
                  const StatusIcon = appearance.icon;
                  return (
                    <li
                      key={delivery.id}
                      className="space-y-2 rounded-xl border px-3 py-3 text-sm sm:px-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {delivery.kind === "test"
                            ? "Проверочное сообщение"
                            : delivery.kind in notificationKindLabels
                              ? notificationKindLabels[
                                  delivery.kind as keyof typeof notificationKindLabels
                                ]
                              : "Событие по объекту"}
                        </span>
                        <span
                          className={cn(
                            "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                            appearance.className,
                          )}
                        >
                          <StatusIcon
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              delivery.status === "processing" && "animate-spin",
                            )}
                            aria-hidden="true"
                          />
                          {telegramStatusLabels[delivery.status] ?? "Неизвестный статус"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(delivery.created_at)} · Попыток: {delivery.attempts}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {telegramDeliveryExplanation(delivery.status, delivery.error_code)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {overview.deliveries.length > 5 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowAllHistory((shown) => !shown)}
              >
                {showAllHistory
                  ? "Свернуть историю"
                  : `Показать всю историю · ${overview.deliveries.length}`}
              </Button>
            )}
            {overview.history_truncated && (
              <p className="text-xs text-muted-foreground">Показаны последние отправки.</p>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
