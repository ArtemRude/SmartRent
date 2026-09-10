import { agreementStatusLabels, type AgreementStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

const styles: Record<AgreementStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  pending_signature: "border-warning/30 bg-warning/15 text-warning-foreground",
  active: "border-success/25 bg-success/12 text-success",
  completed: "border-border bg-secondary text-secondary-foreground",
};

export function AgreementStatusBadge({
  status,
  className,
}: {
  status: AgreementStatus;
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
      {agreementStatusLabels[status]}
    </span>
  );
}
