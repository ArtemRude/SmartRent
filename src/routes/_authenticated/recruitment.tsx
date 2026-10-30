import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RentalApplicationCard } from "@/components/RentalApplicationCard";
import {
  fetchRecruitment,
  fetchCalendarApplication,
  RecruitmentError,
} from "@/lib/recruitment-queries";
import { teamRoleLabels } from "@/lib/team";
import { useAuth } from "@/hooks/auth-context";
export const Route = createFileRoute("/_authenticated/recruitment")({
  validateSearch: (search: Record<string, unknown>): { application?: string } => ({
    ...(typeof search["application"] === "string" ? { application: search["application"] } : {}),
  }),
  component: RecruitmentPage,
});
function RecruitmentPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const search = Route.useSearch();
  const q = useQuery({
    queryKey: ["recruitment", user?.id],
    queryFn: ({ signal }) => fetchRecruitment(signal),
    enabled: Boolean(user) && !search.application,
    refetchInterval: 5000,
    retry: false,
  });
  const focused = useQuery({
    queryKey: ["calendar-application", user?.id, search.application],
    queryFn: ({ signal }) => fetchCalendarApplication(search.application!, signal),
    enabled: Boolean(user && search.application),
    refetchInterval: 5000,
    retry: false,
  });
  const data = !q.isError ? q.data : undefined;
  return (
    <>
      <PageHeader
        title="Поиск арендаторов"
        description="Объявления, показы и ваши отклики на аренду"
        action={
          <Button
            variant="outline"
            onClick={() => void (search.application ? focused.refetch() : q.refetch())}
          >
            Обновить
          </Button>
        }
      />
      <div className="space-y-6">
        {search.application && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Отклик из календаря</h2>
              <Button variant="outline" asChild>
                <Link to="/recruitment" search={{}}>
                  Все отклики и объекты
                </Link>
              </Button>
            </div>
            {focused.isPending && <p>Загружаем выбранный отклик…</p>}
            {focused.isError && (
              <p role="alert" className="text-sm text-destructive">
                Не удалось открыть отклик. Обновите страницу или проверьте ссылку.
              </p>
            )}
            {focused.isSuccess && !focused.data && (
              <p role="alert">Отклик из ссылки недоступен. Доступ мог измениться.</p>
            )}
            {focused.data && !focused.isError && (
              <RentalApplicationCard
                key={`${focused.data.application.id}:${focused.data.application.revision}`}
                application={focused.data.application}
                operator={focused.data.operator}
                owner={focused.data.owner}
                onSaved={() => {
                  void client.invalidateQueries({ queryKey: ["calendar-application"] });
                  void client.invalidateQueries({ queryKey: ["recruitment"] });
                  void client.invalidateQueries({ queryKey: ["rental-calendar"] });
                }}
              />
            )}
          </section>
        )}
        {!search.application && q.isPending && <p>Загружаем сведения…</p>}
        {!search.application && q.isError && (
          <p role="alert" className="text-sm text-destructive">
            {q.error instanceof RecruitmentError && q.error.code === "PGRST202"
              ? "Раздел пока недоступен. Требуется обновление базы данных."
              : q.error.message}
          </p>
        )}
        {data && !search.application && (
          <>
            {data.properties.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Объекты для работы команды</h2>
                {data.properties_truncated && (
                  <p className="text-sm text-muted-foreground">Показаны первые 200 объектов.</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.properties.map((p) => (
                    <Card key={p.id}>
                      <CardContent className="space-y-3 p-5">
                        <h3 className="font-medium">{p.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {p.address} · {teamRoleLabels[p.role]}
                        </p>
                        <Button asChild variant="outline">
                          <Link to="/objects/$propertyId" params={{ propertyId: p.id }}>
                            Открыть страницу объекта
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Мои отклики на аренду</h2>
              {data.applications_truncated && (
                <p className="text-sm text-muted-foreground">Показаны последние 200 откликов.</p>
              )}
              {!data.applications.length && (
                <p className="rounded-xl border p-5 text-sm text-muted-foreground">
                  Откликов пока нет. Откройте публичную ссылку на объявление и отправьте заявку на
                  аренду.
                </p>
              )}
              {data.applications.map((a) => (
                <RentalApplicationCard
                  key={`${a.id}:${a.revision}`}
                  application={a}
                  onSaved={() => {
                    void client.invalidateQueries({ queryKey: ["recruitment"] });
                  }}
                />
              ))}
            </section>
          </>
        )}
      </div>
    </>
  );
}
