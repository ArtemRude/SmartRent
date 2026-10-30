import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/auth-context";
import { cn } from "@/lib/utils";
import { fetchRentalCalendar } from "@/lib/rental-calendar-queries";
import {
  calendarEventHref,
  calendarEventTime,
  calendarKindLabels,
  calendarKindNames,
  calendarKinds,
  calendarMonth,
  calendarMonthGrid,
  calendarRange,
  calendarStatusLabel,
  calendarToday,
  filterCalendarEvents,
  formatCalendarDate,
  shiftCalendarMonth,
  unassignedResponsible,
  type CalendarKind,
  type RentalCalendarEvent,
} from "@/lib/rental-calendar";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Календарь — SmartRent" }] }),
  component: RentalCalendarPage,
});

const kindColors: Record<CalendarKind, string> = {
  payment: "border-amber-200 bg-amber-50 text-amber-950",
  showing: "border-violet-200 bg-violet-50 text-violet-950",
  move_in: "border-emerald-200 bg-emerald-50 text-emerald-950",
  move_out: "border-orange-200 bg-orange-50 text-orange-950",
  repair: "border-sky-200 bg-sky-50 text-sky-950",
};
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";
const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(value);

function CalendarEventCard({
  event,
  propertyName,
  timezone,
}: {
  event: RentalCalendarEvent;
  propertyName: string;
  timezone: string;
}) {
  const href = calendarEventHref(event),
    time = calendarEventTime(event, timezone);
  return (
    <article className="rounded-xl border bg-card p-4" data-testid="calendar-event">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs font-medium",
            kindColors[event.kind],
          )}
        >
          {calendarKindNames[event.kind]}
        </span>
        <span className="text-xs text-muted-foreground">{calendarStatusLabel(event)}</span>
      </div>
      <h3 className="mt-3 break-words font-medium">{event.title}</h3>
      <p className="mt-1 break-words text-sm text-muted-foreground">{propertyName}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {formatCalendarDate(event.date)}
          {time ? ` · ${time}` : " · Весь день"}
        </span>
        <span>Ответственный по объекту: {event.responsible_name || "Не указан"}</span>
      </div>
      {event.kind === "payment" && event.amount !== null && (
        <p className="mt-3 text-sm">
          Начислено: <span className="font-medium">{money(event.amount)}</span>
          {event.paid_amount !== null && event.paid_amount > 0 && (
            <span className="text-muted-foreground"> · Учтено: {money(event.paid_amount)}</span>
          )}
        </p>
      )}
      {event.estimated && (
        <p className="mt-2 text-xs text-muted-foreground">Плановая дата по условиям договора.</p>
      )}
      {href && (
        <a
          href={href}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md py-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Открыть{" "}
          {event.kind === "payment"
            ? "платёж"
            : event.kind === "showing"
              ? "отклик"
              : event.kind === "repair"
                ? "ремонт"
                : event.access === "team"
                  ? "объект команды"
                  : "оформление"}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      )}
    </article>
  );
}

function RentalCalendarPage() {
  const { user } = useAuth();
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const today = calendarToday(timezone);
  const [month, setMonth] = useState(() => calendarMonth(today));
  const [property, setProperty] = useState("");
  const [responsible, setResponsible] = useState("");
  const [kind, setKind] = useState<CalendarKind | "all">("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const range = calendarRange(month),
    days = calendarMonthGrid(month);
  const query = useQuery({
    queryKey: [
      "rental-calendar",
      user?.id,
      range.from,
      range.to,
      timezone,
      property || null,
      responsible || null,
    ],
    queryFn: ({ signal }) =>
      fetchRentalCalendar(
        range.from,
        range.to,
        timezone,
        property || null,
        responsible || null,
        signal,
      ),
    enabled: Boolean(user),
    retry: false,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const data = query.isError ? null : query.data?.overview;
  const events = filterCalendarEvents(data?.events ?? [], { property: "", responsible: "", kind });
  const agenda = events.filter((e) =>
    selectedDay ? e.date === selectedDay : e.date.slice(0, 7) === month.slice(0, 7),
  );
  const eventDays = new Map<string, RentalCalendarEvent[]>();
  for (const event of events)
    eventDays.set(event.date, [...(eventDays.get(event.date) ?? []), event]);
  const responsibleOptions = new Map<string, string>();
  for (const p of data?.properties ?? []) {
    if (p.responsible_id) responsibleOptions.set(p.responsible_id, p.responsible_name);
  }
  const hasUnassigned = data?.properties.some((p) => p.responsible_id === null);
  const changeMonth = (next: string) => {
    setMonth(next);
    setSelectedDay(null);
  };
  const chooseDay = (day: string) => {
    if (calendarMonth(day) !== month) setMonth(calendarMonth(day));
    setSelectedDay(selectedDay === day ? null : day);
  };
  return (
    <>
      <PageHeader
        title="Календарь"
        description="Платежи, показы, заселения, выезды и сроки ремонта"
        action={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", query.isFetching && "animate-spin")} />{" "}
            Обновить
          </Button>
        }
      />
      <Card className="mb-5">
        <CardContent className="space-y-4 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Предыдущий месяц"
                onClick={() => changeMonth(shiftCalendarMonth(month, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2
                className="min-w-0 text-center text-base font-semibold capitalize md:min-w-44 md:text-lg"
                aria-live="polite"
              >
                {new Intl.DateTimeFormat("ru-RU", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${month}T12:00:00Z`))}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Следующий месяц"
                onClick={() => changeMonth(shiftCalendarMonth(month, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMonth(calendarMonth(today));
                setSelectedDay(today);
              }}
            >
              Сегодня
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="calendar-property">Объект</Label>
              <select
                id="calendar-property"
                className={selectClass}
                value={property}
                onChange={(e) => setProperty(e.target.value)}
              >
                <option value="">Все доступные объекты</option>
                {(data?.properties ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="calendar-responsible">Ответственный по объекту</Label>
              <select
                id="calendar-responsible"
                className={selectClass}
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
              >
                <option value="">Все ответственные</option>
                {[...responsibleOptions]
                  .sort((a, b) => a[1].localeCompare(b[1], "ru"))
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                {hasUnassigned && <option value={unassignedResponsible}>Не указан</option>}
              </select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="calendar-kind">События</Label>
              <select
                id="calendar-kind"
                className={selectClass}
                value={kind}
                onChange={(e) => setKind(e.target.value as CalendarKind | "all")}
              >
                <option value="all">Все события</option>
                {calendarKinds.map((value) => (
                  <option key={value} value={value}>
                    {calendarKindLabels[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5 shrink-0" /> Время показов: {timezone}. Даты без времени
            — на весь день.
          </p>
        </CardContent>
      </Card>
      {query.isPending && (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          Загружаем события календаря…
        </p>
      )}
      {query.isError && (
        <Card>
          <CardContent className="p-5">
            <p role="alert" className="text-sm text-destructive">
              Не удалось загрузить календарь. {query.error.message}. Нажмите «Обновить».
            </p>
          </CardContent>
        </Card>
      )}
      {query.data?.available === false && !query.isError && (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Календарь пока недоступен. Попробуйте открыть его позже.
          </CardContent>
        </Card>
      )}
      {data && (
        <div className="space-y-5">
          {data.truncated && (
            <p
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
            >
              Событий слишком много: показана только часть. Выберите объект или ответственного,
              чтобы уточнить календарь.
            </p>
          )}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <table className="w-full table-fixed border-collapse" aria-label="Календарь событий">
                <thead>
                  <tr>
                    {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
                      <th
                        scope="col"
                        key={day}
                        className="border-b bg-muted/50 py-2 text-xs font-medium text-muted-foreground"
                      >
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }, (_, week) => (
                    <tr key={week}>
                      {days.slice(week * 7, week * 7 + 7).map((day) => {
                        const dayEvents = eventDays.get(day) ?? [],
                          outside = day.slice(0, 7) !== month.slice(0, 7);
                        return (
                          <td key={day} className="border-b border-r p-0 align-top last:border-r-0">
                            <button
                              type="button"
                              aria-label={`Выбрать дату ${formatCalendarDate(day, { year: "numeric" })}, событий: ${dayEvents.length}`}
                              aria-pressed={selectedDay === day}
                              onClick={() => chooseDay(day)}
                              className={cn(
                                "flex min-h-16 w-full min-w-0 flex-col gap-1 p-1 text-left transition-colors hover:bg-accent/50 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary md:min-h-28 md:p-2",
                                outside && "bg-muted/25 text-muted-foreground",
                                selectedDay === day &&
                                  "bg-primary/10 ring-1 ring-inset ring-primary",
                              )}
                            >
                              <span
                                className={cn(
                                  "grid h-6 w-6 place-items-center rounded-full text-xs md:text-sm",
                                  day === today &&
                                    "bg-primary font-semibold text-primary-foreground",
                                )}
                              >
                                {Number(day.slice(-2))}
                              </span>
                              {dayEvents.slice(0, 2).map((event) => (
                                <span
                                  key={event.id}
                                  className={cn(
                                    "hidden w-full truncate rounded border px-1 py-0.5 text-[10px] md:block",
                                    kindColors[event.kind],
                                  )}
                                >
                                  {calendarKindNames[event.kind]}
                                </span>
                              ))}
                              {dayEvents.length > 0 && (
                                <span className="text-center text-[10px] font-medium md:hidden">
                                  {dayEvents.length}
                                </span>
                              )}
                              {dayEvents.length > 2 && (
                                <span className="hidden text-[10px] text-muted-foreground md:block">
                                  Ещё {dayEvents.length - 2}
                                </span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <section aria-label="Список событий" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {selectedDay
                  ? formatCalendarDate(selectedDay, { year: "numeric" })
                  : "События месяца"}{" "}
                <span className="font-normal text-muted-foreground">
                  · {agenda.length}
                  {data.truncated ? "+" : ""}
                </span>
              </h2>
              {selectedDay && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
                  Показать весь месяц
                </Button>
              )}
            </div>
            {agenda.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {agenda.map((event) => (
                  <CalendarEventCard
                    key={event.id}
                    event={event}
                    propertyName={
                      data.properties.find((p) => p.id === event.property_id)?.name ?? "Объект"
                    }
                    timezone={data.timezone}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="flex gap-3 p-5">
                  <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium">
                      {data.truncated
                        ? "В загруженной части событий нет"
                        : "Событий по выбранным условиям нет"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {data.truncated
                        ? "Уточните объект или ответственного, чтобы получить полный список."
                        : "Выберите другой день, месяц или измените фильтры."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      )}
    </>
  );
}
