import { queryOptions } from "@tanstack/react-query";
import { fetchNotifications } from "@/lib/queries";

export const NOTIFICATION_REFRESH_INTERVAL = 5_000;

export const notificationQueryOptions = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["notifications", userId],
    queryFn: fetchNotifications,
    enabled: Boolean(userId),
    staleTime: NOTIFICATION_REFRESH_INTERVAL,
  });
