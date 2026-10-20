import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationRow } from "@/lib/queries";
import { RentalUpdateTracker } from "@/lib/rental-updates";

export function useRentalUpdates(
  userId: string | undefined,
  notifications: NotificationRow[] | undefined,
) {
  const queryClient = useQueryClient();
  const tracker = useRef(new RentalUpdateTracker());

  useEffect(() => {
    for (const queryKey of tracker.current.consume(userId, notifications)) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [userId, notifications, queryClient]);
}
