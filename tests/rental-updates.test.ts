import assert from "node:assert/strict";
import { test } from "node:test";
import type { NotificationKind } from "../src/lib/domain.ts";
import { RentalUpdateTracker } from "../src/lib/rental-updates.ts";

const event = (id: string, kind: NotificationKind, user_id = "owner", entity_id = "entity") => ({
  id,
  kind,
  user_id,
  entity_id,
});

const tracker = () => {
  const tracker = new RentalUpdateTracker();
  tracker.consume("owner", []);
  return tracker;
};

test("initial history, unchanged events and marking read do not reload rental data", () => {
  const tracker = new RentalUpdateTracker();
  const notification = event("old", "payment_status");
  assert.deepEqual(tracker.consume("owner", undefined), []);
  assert.deepEqual(tracker.consume("owner", [notification]), []);
  assert.deepEqual(tracker.consume("owner", [{ ...notification, read_at: "2026-10-20" }]), []);
});

test("utility review refreshes billing and both accounts' monthly charge variants", () => {
  assert.deepEqual(tracker().consume("owner", [event("new", "utility_reviewed")]), [
    ["utilities"],
    ["rent-charges"],
    ["property-timeline"],
  ]);
});

test("payment confirmation refreshes reports, balances, receipts and utility summary once", () => {
  const updates = tracker().consume("owner", [
    event("report", "payment_report_status"),
    event("charge", "payment_status"),
  ]);
  assert.deepEqual(updates, [
    ["rent-charges"],
    ["rent-payments"],
    ["payment-reports"],
    ["rent-charge-adjustment-events"],
    ["utilities"],
    ["property-timeline"],
  ]);
  assert.equal(
    updates.some((key) => key[0] === "notifications"),
    false,
  );
});

test("comments refresh only the affected conversation alongside request lists", () => {
  const updates = tracker().consume("owner", [
    event("comment", "request_comment", "owner", "repair"),
  ]);
  assert.deepEqual(updates, [
    ["requests"],
    ["request-comments", "repair"],
    ["request-status-events", "repair"],
    ["property-timeline"],
  ]);
  assert.equal(
    updates.some((key) => key[0] === "rent-charges"),
    false,
  );
});

test("agreement events refresh tenant linkage, acceptance and newly generated charges", () => {
  const keys = tracker()
    .consume("owner", [event("lease", "agreement_accepted")])
    .map((key) => key[0]);
  for (const expected of [
    "agreements",
    "agreement-acceptances",
    "agreement-status-events",
    "my-tenant-records",
    "units",
    "rent-charges",
  ]) {
    assert.ok(keys.includes(expected));
  }
});

test("switching accounts or signing out resets history and ignores other users' events", () => {
  const updates = tracker();
  assert.deepEqual(updates.consume("owner", [event("foreign", "payment_status", "tenant")]), []);
  assert.deepEqual(updates.consume("tenant", undefined), []);
  assert.deepEqual(updates.consume("tenant", [event("baseline", "payment_status", "tenant")]), []);
  assert.ok(updates.consume("tenant", [event("next", "payment_status", "tenant")]).length > 0);
  assert.deepEqual(updates.consume(undefined, undefined), []);
  assert.deepEqual(updates.consume("tenant", [event("next", "payment_status", "tenant")]), []);
});

test("reminders refresh their domain without invalidating unrelated content", () => {
  assert.deepEqual(tracker().consume("owner", [event("due", "payment_due")]), [["rent-charges"]]);
  assert.deepEqual(tracker().consume("owner", [event("lease", "agreement_expiring")]), [
    ["agreements"],
  ]);
});
