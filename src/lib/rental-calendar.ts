export const calendarKinds = ["payment", "showing", "move_in", "move_out", "repair"] as const;
export type CalendarKind = (typeof calendarKinds)[number];
export type CalendarProperty = {
  id: string;
  name: string;
  responsible_id: string | null;
  responsible_name: string;
};
export type RentalCalendarEvent = {
  id: string;
  kind: CalendarKind;
  date: string;
  starts_at: string | null;
  property_id: string;
  title: string;
  status: string;
  responsible_id: string | null;
  responsible_name: string;
  amount: number | null;
  paid_amount: number | null;
  source_id: string;
  agreement_id: string | null;
  request_id: string | null;
  access: "owner" | "team" | "tenant";
  estimated: boolean;
};
export type RentalCalendarOverview = {
  from: string;
  to: string;
  timezone: string;
  properties: CalendarProperty[];
  events: RentalCalendarEvent[];
  truncated: boolean;
};
export const calendarKindLabels: Record<CalendarKind, string> = {
  payment: "Платежи",
  showing: "Показы",
  move_in: "Заселения",
  move_out: "Выезды",
  repair: "Ремонты",
};
export const calendarKindNames: Record<CalendarKind, string> = {
  payment: "Платёж",
  showing: "Показ",
  move_in: "Заселение",
  move_out: "Выезд",
  repair: "Срок ремонта",
};
export const unassignedResponsible = "00000000-0000-0000-0000-000000000000";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}
export function calendarToday(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function calendarMonth(day: string) {
  if (!isCalendarDate(day)) throw new Error("Некорректная дата календаря");
  return `${day.slice(0, 7)}-01`;
}
export function shiftCalendarMonth(month: string, delta: number) {
  const date = new Date(`${calendarMonth(month)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return dateKey(date);
}
export function calendarMonthGrid(month: string) {
  const date = new Date(`${calendarMonth(month)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, () => {
    const key = dateKey(date);
    date.setUTCDate(date.getUTCDate() + 1);
    return key;
  });
}
export function calendarRange(month: string) {
  const days = calendarMonthGrid(month);
  const end = new Date(`${days[41]}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: days[0]!, to: dateKey(end) };
}
export function formatCalendarDate(day: string, options: Intl.DateTimeFormatOptions = {}) {
  if (!isCalendarDate(day)) return "Дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}
export function calendarEventTime(event: RentalCalendarEvent, timezone: string) {
  return event.starts_at
    ? new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
      }).format(new Date(event.starts_at))
    : null;
}
export function calendarStatusLabel(event: RentalCalendarEvent) {
  if (event.estimated) return "По договору";
  const labels: Record<string, string> =
    event.kind === "payment"
      ? { pending: "Ожидается", overdue: "Просрочен", partial: "Частично оплачен", paid: "Оплачен" }
      : event.kind === "showing"
        ? { showing: "Показ назначен", shortlisted: "В отборе" }
        : event.kind === "repair"
          ? {
              draft: "Черновик",
              pending: "Смета на согласовании",
              approved: "Согласовано",
              in_progress: "В работе",
              review: "На приёмке",
              completed: "Принято",
            }
          : {
              planned: "По договору",
              draft: "Черновик акта",
              pending: "Ожидает арендатора",
              confirmed: "Акт подтверждён",
              disputed: "Есть замечания",
            };
  return labels[event.status] ?? "Событие";
}
export function calendarEventHref(event: RentalCalendarEvent): string | null {
  if (!uuid.test(event.source_id) || !uuid.test(event.property_id)) return null;
  if (event.kind === "payment") return `/payments?charge=${event.source_id}`;
  if (event.kind === "showing") return `/recruitment?application=${event.source_id}`;
  if (event.kind === "repair")
    return `/repairs?property=${event.property_id}&job=${event.source_id}`;
  if (event.access === "team") return `/team?property=${event.property_id}`;
  if (!event.agreement_id || !uuid.test(event.agreement_id)) return null;
  return `/handover?agreement=${event.agreement_id}&kind=${event.kind}`;
}
export function filterCalendarEvents(
  events: readonly RentalCalendarEvent[],
  filters: {
    property: string;
    responsible: string;
    kind: CalendarKind | "all";
  },
) {
  return events
    .filter(
      (event) =>
        (!filters.property || event.property_id === filters.property) &&
        (!filters.responsible ||
          (filters.responsible === unassignedResponsible
            ? event.responsible_id === null
            : event.responsible_id === filters.responsible)) &&
        (filters.kind === "all" || event.kind === filters.kind),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.starts_at ?? "").localeCompare(b.starts_at ?? "") ||
        a.id.localeCompare(b.id),
    );
}

/** Reject incomplete responses rather than treating an unavailable source as an empty month. */
export function readRentalCalendar(value: unknown): RentalCalendarOverview {
  const data = value as RentalCalendarOverview | null;
  const validString = (v: unknown): v is string => typeof v === "string";
  const validResponsible = (v: Pick<CalendarProperty, "responsible_id" | "responsible_name">) =>
    (v.responsible_id === null || (validString(v.responsible_id) && uuid.test(v.responsible_id))) &&
    validString(v.responsible_name);
  if (
    !data ||
    !isCalendarDate(data.from) ||
    !isCalendarDate(data.to) ||
    data.from >= data.to ||
    typeof data.timezone !== "string" ||
    !Array.isArray(data.properties) ||
    !Array.isArray(data.events) ||
    typeof data.truncated !== "boolean"
  )
    throw new Error("Получен неполный календарь. Обновите раздел.");
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone });
  } catch {
    throw new Error("Не удалось определить часовой пояс календаря");
  }
  if (
    data.properties.some(
      (p) => !p || !uuid.test(p.id) || !validString(p.name) || !validResponsible(p),
    ) ||
    data.events.some(
      (e) =>
        !e ||
        !validString(e.id) ||
        !calendarKinds.includes(e.kind) ||
        !isCalendarDate(e.date) ||
        e.date < data.from ||
        e.date >= data.to ||
        !(
          e.starts_at === null ||
          (validString(e.starts_at) && Number.isFinite(Date.parse(e.starts_at)))
        ) ||
        !uuid.test(e.property_id) ||
        !uuid.test(e.source_id) ||
        !validString(e.title) ||
        !validString(e.status) ||
        !validResponsible(e) ||
        !["owner", "team", "tenant"].includes(e.access) ||
        typeof e.estimated !== "boolean" ||
        ![e.amount, e.paid_amount].every(
          (n) => n === null || (typeof n === "number" && Number.isFinite(n) && n >= 0),
        ) ||
        ![e.agreement_id, e.request_id].every(
          (id) => id === null || (typeof id === "string" && uuid.test(id)),
        ) ||
        !data.properties.some((p) => p.id === e.property_id),
    )
  )
    throw new Error("Получен неполный календарь. Обновите раздел.");
  return data;
}
