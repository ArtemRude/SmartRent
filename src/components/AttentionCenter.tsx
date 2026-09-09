import type { LucideIcon } from "lucide-react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type AttentionRoute = "/payments" | "/requests" | "/agreements";

type AttentionGroup = {
  title: string;
  description: string;
  count: number;
  icon: LucideIcon;
  to: AttentionRoute;
  tone: "danger" | "warning" | "primary" | "default";
  items: Array<{ id: string; title: string; meta: string }>;
};

const toneStyles: Record<AttentionGroup["tone"], string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/12 text-warning",
  primary: "bg-primary/10 text-primary",
  default: "bg-accent text-accent-foreground",
};

export function AttentionCenter({ groups }: { groups: AttentionGroup[] }) {
  const total = groups.reduce((sum, group) => sum + group.count, 0);

  return (
    <Card className="mb-6 border-primary/20 bg-primary/[0.025]">
      <CardHeader className={total > 0 ? "pb-3" : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Центр внимания</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {total > 0 ? `Требуют внимания: ${total}` : "На сегодня срочных задач нет"}
            </p>
          </div>
          {total === 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-success/12 px-3 py-1 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Всё в порядке
            </span>
          )}
        </div>
      </CardHeader>
      {total > 0 && (
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((group) => {
              const Icon = group.icon;
              return (
                <div key={group.title} className="rounded-xl border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <span
                        className={cn(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                          toneStyles[group.tone],
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium">{group.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-semibold">
                      {group.count}
                    </span>
                  </div>

                  {group.items.length > 0 ? (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      {group.items.slice(0, 3).map((item) => (
                        <Link
                          key={item.id}
                          to={group.to}
                          className="flex items-center justify-between gap-3 rounded-md px-1 py-0.5 text-sm transition-colors hover:bg-muted/60"
                        >
                          <span className="truncate">{item.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {item.meta}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">Нет задач</p>
                  )}

                  <Link
                    to={group.to}
                    className="mt-3 inline-flex items-center text-xs font-medium text-primary hover:underline"
                  >
                    Открыть раздел <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
