import { paymentStatusLabels, type PaymentStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

const styles: Record<PaymentStatus, string> = {
  pending: "border-warning/30 bg-warning/15 text-warning-foreground",
  paid: "border-success/25 bg-success/12 text-success",
  overdue: "border-destructive/25 bg-destructive/10 text-destructive",
};

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: PaymentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[status],
        className,
      )}
    >
      {paymentStatusLabels[status]}
    </span>
  );
}
