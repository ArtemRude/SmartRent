import { CreditCard, FileText, Inbox, MessageCircle, type LucideIcon } from "lucide-react";
import type { NotificationKind } from "@/lib/domain";

export const notificationIcons: Record<NotificationKind, LucideIcon> = {
  request_created: Inbox,
  request_comment: MessageCircle,
  request_status: Inbox,
  agreement_created: FileText,
  payment_status: CreditCard,
};
