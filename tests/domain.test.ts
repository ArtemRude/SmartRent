import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysUntil,
  formatMoney,
  getDefaultLeaseDates,
  getPaymentStatus,
  localDateKey,
  paymentStatusLabels,
  requestStatusLabels,
} from "../src/lib/domain.ts";

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
