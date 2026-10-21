import type { NotificationKind } from "./domain.ts";

type RentalNotification = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  entity_id: string;
};

type UpdateKey = readonly string[];

const agreementKeys: UpdateKey[] = [
  ["property-finances"],
  ["agreements"],
  ["agreement-status-events"],
  ["agreement-acceptances"],
  ["properties"],
  ["property"],
  ["units"],
  ["tenants"],
  ["my-tenant-records"],
  ["rent-charges"],
  ["utilities"],
  ["property-timeline"],
];
const paymentKeys: UpdateKey[] = [
  ["property-finances"],
  ["rent-charges"],
  ["rent-payments"],
  ["payment-reports"],
  ["rent-charge-adjustment-events"],
  ["utilities"],
  ["property-timeline"],
];

function keysForNotification(notification: RentalNotification): UpdateKey[] {
  switch (notification.kind) {
    case "request_created":
    case "request_comment":
    case "request_status":
      return [
        ["requests"],
        ["request-comments", notification.entity_id],
        ["request-status-events", notification.entity_id],
        ["property-timeline"],
      ];
    case "agreement_amendment":
      return [["lease-changes"], ...agreementKeys, ...paymentKeys];
    case "agreement_created":
    case "agreement_status":
    case "agreement_accepted":
      return agreementKeys;
    case "handover_status":
      return [["handovers"], ...agreementKeys, ...paymentKeys];
    case "agreement_expiring":
      return [["agreements"]];
    case "payment_status":
    case "payment_reported":
    case "payment_report_status":
      return paymentKeys;
    case "payment_due":
    case "payment_overdue":
    case "payment_reminder":
      return [["rent-charges"]];
    case "utility_submitted":
    case "utility_reviewed":
      return [["utilities"], ["rent-charges"], ["property-timeline"]];
    default:
      return [];
  }
}

/** One tracker per mounted app shell. Reading a notification isn't a new rental event. */
export class RentalUpdateTracker {
  private userId: string | undefined;
  private seen: Set<string> | undefined;

  consume(
    userId: string | undefined,
    notifications: readonly RentalNotification[] | undefined,
  ): UpdateKey[] {
    if (this.userId !== userId) {
      this.userId = userId;
      this.seen = undefined;
    }
    if (!userId || !notifications) return [];

    const ownNotifications = notifications.filter((item) => item.user_id === userId);
    const previous = this.seen;
    // The API returns the latest 100 events, so retaining this snapshot bounds memory use.
    this.seen = new Set(ownNotifications.map((item) => item.id));
    if (!previous) return [];

    const keys = ownNotifications
      .filter((item) => !previous.has(item.id))
      .flatMap(keysForNotification);
    return [...new Map(keys.map((key) => [JSON.stringify(key), key])).values()];
  }
}
