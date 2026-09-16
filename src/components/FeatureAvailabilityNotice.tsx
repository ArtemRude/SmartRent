import { AlertTriangle, ChevronDown, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function FeatureAvailabilityNotice({
  issues,
  isAdmin,
  retrying,
  onRetry,
}: {
  issues: string[];
  isAdmin: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (issues.length === 0) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        className="mt-4 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900 transition-colors hover:bg-amber-100/70"
        aria-expanded="false"
        onClick={() => setExpanded(true)}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Некоторые функции платежей временно недоступны</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Некоторые функции платежей временно недоступны</p>
          <p className="mt-1 text-xs text-amber-900/80">
            Основные операции продолжают работать. Повторите проверку через несколько минут.
          </p>
          {isAdmin && (
            <div className="mt-3 rounded-lg bg-white/55 px-3 py-2 text-xs">
              <p className="font-medium">Технические подробности</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 bg-white/70"
            disabled={retrying}
            onClick={onRetry}
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Проверяем…" : "Проверить снова"}
          </Button>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="-mr-2 -mt-2 h-8 w-8 shrink-0"
          aria-label="Свернуть сообщение"
          onClick={() => setExpanded(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
