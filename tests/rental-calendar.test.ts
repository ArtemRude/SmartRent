import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarEventHref,
  calendarEventTime,
  calendarMonthGrid,
  calendarRange,
  calendarStatusLabel,
  calendarToday,
  filterCalendarEvents,
  formatCalendarDate,
  isCalendarDate,
  readRentalCalendar,
  shiftCalendarMonth,
  unassignedResponsible,
  type RentalCalendarEvent,
  type RentalCalendarOverview,
} from "../src/lib/rental-calendar.ts";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function event(values: Partial<RentalCalendarEvent> = {}): RentalCalendarEvent {
  return {
    id: "payment:1",
    kind: "payment",
    date: "2026-10-29",
    starts_at: null,
    property_id: uuid(1),
    title: "Аренда",
    status: "pending",
    responsible_id: uuid(2),
    responsible_name: "Собственник",
    amount: 1000,
    paid_amount: 0,
    source_id: uuid(3),
    agreement_id: uuid(4),
    request_id: null,
    access: "owner",
    estimated: false,
    ...values,
  };
}
function overview(events = [event()]): RentalCalendarOverview {
  return {
    from: "2026-09-28",
    to: "2026-11-09",
    timezone: "Europe/Moscow",
    truncated: false,
    properties: [
      { id: uuid(1), name: "Объект", responsible_id: uuid(2), responsible_name: "Собственник" },
    ],
    events,
  };
}

test("month grid starts Monday, is bounded to six weeks and handles leap/year boundaries", () => {
  const days = calendarMonthGrid("2026-10-01");
  assert.equal(days.length, 42);
  assert.equal(days[0], "2026-09-28");
  assert.equal(days[41], "2026-11-08");
  assert.deepEqual(calendarRange("2026-10-01"), { from: "2026-09-28", to: "2026-11-09" });
  assert.equal(shiftCalendarMonth("2026-12-31", 1), "2027-01-01");
  assert.ok(calendarMonthGrid("2028-02-01").includes("2028-02-29"));
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.throws(() => shiftCalendarMonth("2026-02-30", 1));
});

test("date-only values stay on the same day; timed showings respect the requested timezone", () => {
  assert.equal(calendarToday("Europe/Moscow", new Date("2026-10-28T22:30:00Z")), "2026-10-29");
  assert.equal(
    calendarToday("America/Los_Angeles", new Date("2026-10-29T01:30:00Z")),
    "2026-10-28",
  );
  assert.equal(formatCalendarDate("2026-10-29"), "29 октября");
  assert.equal(
    calendarEventTime(
      event({ kind: "showing", starts_at: "2026-10-28T22:30:00Z" }),
      "Europe/Moscow",
    ),
    "01:30",
  );
  assert.equal(calendarEventTime(event(), "Pacific/Kiritimati"), null);
});

test("filters intersect object, stable responsible id and event kind, without selecting a substitute", () => {
  const items = [
    event(),
    event({ id: "showing:2", kind: "showing", responsible_id: null }),
    event({ id: "repair:3", kind: "repair", property_id: uuid(5) }),
  ];
  assert.deepEqual(
    filterCalendarEvents(items, {
      property: uuid(1),
      responsible: unassignedResponsible,
      kind: "showing",
    }).map((e) => e.id),
    ["showing:2"],
  );
  assert.equal(
    filterCalendarEvents(items, { property: uuid(99), responsible: "", kind: "all" }).length,
    0,
  );
  assert.equal(
    filterCalendarEvents(items, { property: "", responsible: uuid(2), kind: "all" }).length,
    2,
  );
});

test("actions target their exact source and route team lease dates to the authorized workspace", () => {
  assert.equal(calendarEventHref(event()), `/payments?charge=${uuid(3)}`);
  assert.equal(
    calendarEventHref(event({ kind: "showing", access: "tenant" })),
    `/recruitment?application=${uuid(3)}`,
  );
  assert.equal(
    calendarEventHref(event({ kind: "repair" })),
    `/repairs?property=${uuid(1)}&job=${uuid(3)}`,
  );
  assert.equal(
    calendarEventHref(event({ kind: "move_in", access: "tenant" })),
    `/handover?agreement=${uuid(4)}&kind=move_in`,
  );
  assert.equal(
    calendarEventHref(event({ kind: "move_out", access: "team" })),
    `/team?property=${uuid(1)}`,
  );
  assert.equal(calendarEventHref(event({ source_id: "https://example.com" })), null);
  assert.equal(calendarEventHref(event({ kind: "move_out", agreement_id: null })), null);
});

test("estimated dates are labelled as contract plans, not confirmed inspections or payments", () => {
  assert.equal(
    calendarStatusLabel(event({ kind: "move_in", status: "planned", estimated: true })),
    "По договору",
  );
  assert.equal(
    calendarStatusLabel(event({ kind: "move_out", status: "confirmed" })),
    "Акт подтверждён",
  );
  assert.equal(calendarStatusLabel(event({ status: "partial" })), "Частично оплачен");
  assert.equal(calendarStatusLabel(event({ status: "overdue" })), "Просрочен");
});

test("an empty successful calendar is distinct from incomplete, foreign-period or invalid data", () => {
  assert.equal(readRentalCalendar(overview([])).events.length, 0);
  for (const bad of [
    null,
    {},
    { ...overview(), events: null },
    { ...overview(), truncated: undefined },
    overview([event({ date: "2026-12-01" })]),
    overview([event({ amount: NaN })]),
    overview([event({ property_id: uuid(9) })]),
    overview([event({ starts_at: "not-a-date" })]),
    { ...overview(), timezone: "invalid/timezone" },
  ]) {
    assert.throws(() => readRentalCalendar(bad));
  }
});
