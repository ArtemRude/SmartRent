import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calendarDaysBetween,
  daysUntil,
  formatMoney,
  getDefaultLeaseDates,
  getPaymentStatus,
  getRentChargeTotal,
  getRenewalLeaseDates,
  localDateKey,
  paymentStatusLabels,
  requestStatusLabels,
} from "../src/lib/domain.ts";
import { normalizeTenantEmail, validateTenantDetails } from "../src/lib/tenant.ts";

test("payment status is paid when a payment date exists", () => {
  assert.equal(
    getPaymentStatus({ paid_at: "2026-08-26T10:00:00.000Z", due_date: "2026-08-01" }),
    "paid",
  );
});

test("payment status distinguishes overdue and upcoming charges", () => {
  assert.equal(getPaymentStatus({ paid_at: null, due_date: "2000-01-01" }), "overdue");
  assert.equal(getPaymentStatus({ paid_at: null, due_date: "2999-01-01" }), "pending");
});

test("rent charge total includes positive, negative, and missing adjustments", () => {
  assert.equal(getRentChargeTotal({ amount: 50000, adjustment_amount: 2500 }), 52500);
  assert.equal(getRentChargeTotal({ amount: 50000, adjustment_amount: -3000 }), 47000);
  assert.equal(getRentChargeTotal({ amount: 50000 }), 50000);
});

test("localDateKey uses the local calendar date", () => {
  assert.equal(localDateKey(new Date(2026, 7, 26, 23, 59)), "2026-08-26");
});

test("new leases default to a full year starting today", () => {
  assert.deepEqual(getDefaultLeaseDates(new Date(2026, 8, 8, 12)), {
    startDate: "2026-09-08",
    endDate: "2027-09-07",
  });
});

test("new lease defaults handle leap day without overflowing", () => {
  assert.deepEqual(getDefaultLeaseDates(new Date(2028, 1, 29, 12)), {
    startDate: "2028-02-29",
    endDate: "2029-02-28",
  });
});

test("renewal starts after the current agreement and lasts a full year", () => {
  assert.deepEqual(getRenewalLeaseDates("2027-09-07"), {
    startDate: "2027-09-08",
    endDate: "2028-09-07",
  });
});

test("renewal dates preserve a leap-day start", () => {
  assert.deepEqual(getRenewalLeaseDates("2028-02-28"), {
    startDate: "2028-02-29",
    endDate: "2029-02-28",
  });
});

test("calendar date distance is stable across months and leap years", () => {
  assert.equal(calendarDaysBetween("2026-09-09", "2026-09-16"), 7);
  assert.equal(calendarDaysBetween("2028-02-28", "2028-03-01"), 2);
  assert.equal(calendarDaysBetween("2026-09-09", "2026-09-08"), -1);
});

test("daysUntil reports future and past dates with the expected sign", () => {
  const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const yesterday = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

  assert.ok(daysUntil(tomorrow) > 0);
  assert.ok(daysUntil(yesterday) < 0);
});

test("Russian labels and money formatting stay user-facing", () => {
  assert.equal(requestStatusLabels.in_progress, "В работе");
  assert.equal(paymentStatusLabels.overdue, "Просрочено");
  assert.match(formatMoney(50000), /50[\s\u00a0]?000/);
  assert.match(formatMoney(50000), /₽/);
});

test("tenant email is normalized before duplicate checks and saving", () => {
  assert.equal(normalizeTenantEmail("  Tenant@Example.COM "), "tenant@example.com");
});

test("tenant details require a name and a valid email", () => {
  assert.equal(validateTenantDetails("", "tenant@example.com"), "Укажите имя арендатора");
  assert.equal(validateTenantDetails("Анна", "invalid"), "Укажите корректный email");
  assert.equal(validateTenantDetails("Анна", "tenant@example.com"), null);
});
