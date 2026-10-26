import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { ReminderSettingsCard } from "@/components/ReminderSettingsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/auth-context";
import { formatDateTime, notificationKindLabels } from "@/lib/domain";
import {
  fetchReminderSettings,
  markAllNotificationsRead,
  markNotificationRead,
  saveReminderSettings,
  type NotificationRow,
} from "@/lib/queries";
import { notificationIcons } from "@/lib/notifications";
import { notificationQueryOptions } from "@/lib/notification-query";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Уведомления — SmartRent" },
      {
        name: "description",
        content: "Новые заявки, комментарии, статусы договоров и платежей.",
      },
    ],
  }),
  component: NotificationsPage,
});

type NotificationFilter = "all" | "unread" | "reminders";

const NOTIFICATIONS_PAGE_SIZE = 20;

function notificationDateLabel(createdAt: string, now = new Date()) {
  const date = new Date(createdAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (daysAgo === 0) return "Сегодня";
  if (daysAgo === 1) return "Вчера";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function NotificationCard({
  notification,
  onRead,
  reading,
}: {
  notification: NotificationRow;
  onRead: (id: string) => void;
  reading: boolean;
}) {
  const Icon = notificationIcons[notification.kind];
  const unread = notification.read_at == null;

  return (
    <Card className={cn(unread && "border-primary/25 bg-primary/[0.025]")}>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
            unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{notification.title}</p>
            {unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Новое" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {notificationKindLabels[notification.kind]} · {formatDateTime(notification.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-col sm:items-stretch">
          <Button asChild size="sm" variant={unread ? "default" : "outline"}>
            <Link
              to={notification.href}
              onClick={() => {
                if (unread) onRead(notification.id);
              }}
            >
              Открыть
            </Link>
          </Button>
          {unread && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRead(notification.id)}
              disabled={reading}
            >
              <Check className="mr-2 h-4 w-4" /> Прочитано
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationsPage() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(NOTIFICATIONS_PAGE_SIZE);
  const notifications = useQuery(notificationQueryOptions(user?.id));
  const reminderSettings = useQuery({
    queryKey: ["reminder-settings", user?.id],
    queryFn: () => fetchReminderSettings(user!.id),
    enabled: Boolean(user && role === "owner"),
  });
  const allNotifications = useMemo(() => notifications.data ?? [], [notifications.data]);
  const unreadCount = allNotifications.filter(
    (notification) => notification.read_at == null,
  ).length;
  const reminderNotifications = allNotifications.filter((notification) =>
    ["agreement_expiring", "payment_due", "payment_overdue", "payment_reminder"].includes(
      notification.kind,
    ),
  );
  const filteredNotifications =
    filter === "unread"
      ? allNotifications.filter((notification) => notification.read_at == null)
      : filter === "reminders"
        ? reminderNotifications
        : allNotifications;
  const visibleNotifications = filteredNotifications.slice(0, visibleLimit);
  const groupedNotifications = visibleNotifications.reduce<
    Array<{ label: string; notifications: NotificationRow[] }>
  >((groups, notification) => {
    const label = notificationDateLabel(notification.created_at);
    const lastGroup = groups.at(-1);

    if (lastGroup?.label === label) {
      lastGroup.notifications.push(notification);
    } else {
      groups.push({ label, notifications: [notification] });
    }

    return groups;
  }, []);

  useEffect(() => {
    setVisibleLimit(NOTIFICATIONS_PAGE_SIZE);
  }, [filter]);

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications", user?.id] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      toast.success("Все уведомления прочитаны");
      void qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveSettings = useMutation({
    mutationFn: saveReminderSettings,
    onSuccess: (saved) => {
      qc.setQueryData(["reminder-settings", user?.id], saved);
      toast.success("Настройки напоминаний сохранены");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title="Уведомления"
        description="Заявки, комментарии, договоры и изменения платежей"
        action={
          <Button
            variant="outline"
            onClick={() => markAllRead.mutate()}
            disabled={unreadCount === 0 || markAllRead.isPending}
          >
            <CheckCheck className="mr-2 h-4 w-4" /> Прочитать все
          </Button>
        }
      />

      <TelegramSettingsCard />

      {role === "owner" && reminderSettings.data && (
        <ReminderSettingsCard
          settings={reminderSettings.data}
          saving={saveSettings.isPending}
          onChange={(key, value) =>
            saveSettings.mutate({ ...reminderSettings.data!, [key]: value })
          }
        />
      )}

      {role === "owner" && reminderSettings.isError && (
        <Card className="mb-4 border-destructive/20">
          <CardContent className="p-5 text-sm text-destructive">
            Настройки напоминаний временно недоступны. Попробуйте обновить страницу позже.
          </CardContent>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            Все · {allNotifications.length}
          </Button>
          <Button
            size="sm"
            variant={filter === "unread" ? "default" : "outline"}
            onClick={() => setFilter("unread")}
          >
            Непрочитанные · {unreadCount}
          </Button>
          <Button
            size="sm"
            variant={filter === "reminders" ? "default" : "outline"}
            onClick={() => setFilter("reminders")}
          >
            Напоминания · {reminderNotifications.length}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Обновляются автоматически</p>
      </div>

      {notifications.isPending && (
        <p className="text-sm text-muted-foreground">Загружаем уведомления…</p>
      )}
      {notifications.isError && (
        <p className="text-sm text-destructive">
          Не удалось загрузить уведомления. Попробуйте обновить страницу позже.
        </p>
      )}

      {!notifications.isPending && !notifications.isError && groupedNotifications.length > 0 && (
        <div className="space-y-6">
          {groupedNotifications.map((group, groupIndex) => (
            <section key={group.label} aria-labelledby={`notifications-group-${groupIndex}`}>
              <h2
                id={`notifications-group-${groupIndex}`}
                className="mb-3 text-sm font-medium text-muted-foreground"
              >
                {group.label}
              </h2>
              <div className="space-y-3">
                {group.notifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onRead={(id) => markRead.mutate(id)}
                    reading={markRead.isPending}
                  />
                ))}
              </div>
            </section>
          ))}

          {visibleNotifications.length < filteredNotifications.length && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setVisibleLimit((current) => current + NOTIFICATIONS_PAGE_SIZE)}
              >
                Показать ещё ·{" "}
                {Math.min(
                  NOTIFICATIONS_PAGE_SIZE,
                  filteredNotifications.length - visibleNotifications.length,
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Показано {visibleNotifications.length} из {filteredNotifications.length}
              </p>
            </div>
          )}
        </div>
      )}

      {!notifications.isPending && !notifications.isError && filteredNotifications.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <Bell className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">
              {filter === "unread"
                ? "Новых уведомлений нет"
                : filter === "reminders"
                  ? "Напоминаний пока нет"
                  : "Уведомлений пока нет"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Здесь появятся новые заявки, комментарии и изменения по аренде.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
