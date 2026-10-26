import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Send } from "lucide-react";
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
  type TelegramLink,
  type TelegramTopic,
} from "@/lib/telegram";

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

  return (
    <Card className="mb-4" data-testid="telegram-settings">
      <CardContent className="space-y-5 p-5 md:p-6">
        <div className="flex items-start gap-3">
          <Send className="mt-1 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Telegram-уведомления</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Новые события по вашим объектам и аренде — даже когда кабинет закрыт. Действия
              выполняются в кабинете.
            </p>
          </div>
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
          <>
            {overview.connection ? (
              <div className="space-y-3 rounded-xl border p-4">
                <p className="break-words text-sm font-medium">
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
                  Отключить Telegram
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border p-4">
                <p className="text-sm">
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
                  <div className="space-y-3 rounded-lg bg-muted p-3" role="status">
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
                      <Button variant="outline" disabled={busy} onClick={() => disconnect.mutate()}>
                        Отменить подключение
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
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
            <fieldset disabled={busy || !overview.connection} className="space-y-3">
              <legend className="mb-3 text-sm font-semibold">Темы уведомлений</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.entries(telegramTopics) as [TelegramTopic, string][]).map(
                  ([topic, label]) => (
                    <label
                      key={topic}
                      className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"
                    >
                      <span>{label}</span>
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
            <div className="space-y-2">
              <Button
                variant="outline"
                className="max-w-full whitespace-normal"
                disabled={busy || !overview.connection || !overview.enabled || testWait > 0}
                onClick={() => sendTest.mutate()}
              >
                Отправить проверочное сообщение{testWait > 0 ? ` (${testWait} с)` : ""}
              </Button>
              <p className="text-xs text-muted-foreground">
                Проверка отправляется через общую очередь. Результат появится в истории.
              </p>
            </div>
          </>
        )}
        {overview && (
          <section aria-label="История отправок Telegram" className="space-y-3">
            <h3 className="text-sm font-semibold">История отправок</h3>
            <p className="text-xs text-muted-foreground">
              Статус «Принято Telegram» не означает, что сообщение прочитано.
            </p>
            {overview.deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Отправок пока нет.</p>
            ) : (
              <ul className="space-y-3">
                {overview.deliveries.map((delivery) => (
                  <li key={delivery.id} className="space-y-1 rounded-xl border p-3 text-sm">
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
                      <span>{telegramStatusLabels[delivery.status] ?? "Неизвестный статус"}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(delivery.created_at)} · Попыток: {delivery.attempts}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {telegramDeliveryExplanation(delivery.status, delivery.error_code)}
                    </p>
                  </li>
                ))}
              </ul>
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
