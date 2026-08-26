import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysUntil,
  formatMoney,
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
