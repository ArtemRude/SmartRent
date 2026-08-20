import { requestStatusLabels, type RequestStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

const styles: Record<RequestStatus, string> = {
  new: "bg-primary/10 text-primary border-primary/20",
  in_progress: "bg-warning/15 text-warning-foreground border-warning/30",
  closed: "bg-success/12 text-success border-success/25",
};

export function StatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[status],
        className,
      )}
    >
      {requestStatusLabels[status]}
    </span>
  );
}
