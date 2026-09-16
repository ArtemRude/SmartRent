import {
  CalendarClock,
  CircleAlert,
  CreditCard,
  FileText,
  Inbox,
  MessageCircle,
  Send,
  type LucideIcon,
} from "lucide-react";
import type { NotificationKind } from "@/lib/domain";

export const notificationIcons: Record<NotificationKind, LucideIcon> = {
  request_created: Inbox,
  request_comment: MessageCircle,
  request_status: Inbox,
  agreement_created: FileText,
  agreement_status: FileText,
  agreement_accepted: FileText,
  agreement_expiring: CalendarClock,
  payment_status: CreditCard,
  payment_due: CalendarClock,
  payment_overdue: CircleAlert,
  payment_reminder: Send,
  payment_reported: CreditCard,
  payment_report_status: CreditCard,
};
