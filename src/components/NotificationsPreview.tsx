import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/auth-context";
import { formatDateTime } from "@/lib/domain";
import { notificationIcons } from "@/lib/notifications";
import { fetchNotifications, markNotificationRead, type NotificationRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

function PreviewItem({
  notification,
  onRead,
}: {
  notification: NotificationRow;
  onRead: (id: string) => void;
}) {
  const Icon = notificationIcons[notification.kind];
  const unread = notification.read_at == null;

  return (
    <Link
      to={notification.href}
      onClick={() => {
        if (unread) onRead(notification.id);
      }}
      className="group flex items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/60"
    >
      <span
        className={cn(
          "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{notification.title}</span>
          {unread && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Новое" />
          )}
        </span>
        {notification.body && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {notification.body}
          </span>
        )}
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatDateTime(notification.created_at)}
        </span>
      </span>
      {unread && (
        <Check className="mt-2 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </Link>
  );
}

export function NotificationsPreview({ className }: { className?: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: fetchNotifications,
    enabled: Boolean(user),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const allNotifications = notifications.data ?? [];
  const unreadCount = allNotifications.filter((item) => item.read_at == null).length;
  const latestNotifications = allNotifications.slice(0, 3);
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] }),
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" /> Уведомления
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/notifications">Все уведомления</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {notifications.isPending && (
          <p className="text-sm text-muted-foreground">Загружаем уведомления…</p>
        )}
        {notifications.isError && (
          <p className="text-sm text-destructive">Не удалось загрузить уведомления.</p>
        )}
        {!notifications.isPending && !notifications.isError && latestNotifications.length > 0 && (
          <div className="space-y-2">
            {latestNotifications.map((notification) => (
              <PreviewItem
                key={notification.id}
                notification={notification}
                onRead={(id) => markRead.mutate(id)}
              />
            ))}
          </div>
        )}
        {!notifications.isPending && !notifications.isError && latestNotifications.length === 0 && (
          <div className="py-4 text-center">
            <Bell className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Уведомлений пока нет</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Новые события по аренде появятся здесь.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
