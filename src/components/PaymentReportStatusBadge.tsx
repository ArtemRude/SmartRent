import { Ban, CheckCircle2, Clock3, XCircle } from "lucide-react";
import type { PaymentReport } from "@/lib/queries";
import { cn } from "@/lib/utils";

const statusDetails = {
  pending: {
    label: "На проверке",
    icon: Clock3,
    className: "bg-amber-100 text-amber-800",
  },
  approved: {
    label: "Подтверждено",
    icon: CheckCircle2,
    className: "bg-emerald-100 text-emerald-800",
  },
  rejected: {
    label: "Отклонено",
    icon: XCircle,
    className: "bg-red-100 text-red-800",
  },
  cancelled: {
    label: "Отменено",
    icon: Ban,
    className: "bg-muted text-muted-foreground",
  },
} satisfies Record<
  PaymentReport["status"],
  { label: string; icon: typeof Clock3; className: string }
>;

export function PaymentReportStatusBadge({ status }: { status: PaymentReport["status"] }) {
  const details = statusDetails[status];
  const Icon = details.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        details.className,
      )}
    >
      <Icon className="h-3 w-3" />
      {details.label}
    </span>
  );
}
