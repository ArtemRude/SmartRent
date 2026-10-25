import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billingPhase,
  billingGraceUntil,
  getBillingAccess,
  parseBillingOverview,
  type BillingOverview,
} from "../src/lib/billing.ts";

const now = Date.parse("2026-12-01T12:00:00Z");
const base: BillingOverview = {
  available: true,
  mode: "prelaunch",
  launched_at: null,
  notice_until: null,
  plan: "start",
  paid_until: null,
  trial_until: null,
  units_used: 35,
  seats_used: 4,
};

test("prelaunch never restricts existing or new operations despite expired subscription", () => {
  const access = getBillingAccess(
    { ...base, plan: "owner", paid_until: "2020-01-01T00:00:00Z" },
    now,
  );
  assert.equal(access.phase, "prelaunch");
  assert.equal(access.unrestricted, true);
  for (const key of [
    "canCreateUnits",
    "canInvite",
    "canCreateExpenses",
    "canCreateRepairs",
    "canPublishListings",
    "canStartLease",
  ] as const)
    assert.equal(access[key], true, key);
});

test("an unavailable server never claims prelaunch or grants access from an assumed mode", () => {
  const access = getBillingAccess({ ...base, available: false }, now);
  assert.equal(access.phase, "unavailable");
  assert.equal(access.canStartLease, false);
  assert.equal(access.canCreateExpenses, false);
});

test("notice remains unrestricted until its exact expiration", () => {
  const overview = {
    ...base,
    mode: "enforced" as const,
    notice_until: new Date(now + 1).toISOString(),
  };
  assert.equal(getBillingAccess(overview, now).unrestricted, true);
  assert.equal(billingPhase(overview, now + 1), "restricted");
});

test("paid access and seven grace days end at exact boundaries", () => {
  const overview = {
    ...base,
    mode: "enforced" as const,
    plan: "team" as const,
    paid_until: new Date(now).toISOString(),
  };
  assert.equal(billingPhase(overview, now - 1), "active");
  assert.equal(billingPhase(overview, now), "grace");
  const graceEnd = now + 7 * 86400000;
  assert.equal(billingGraceUntil(overview), new Date(graceEnd).toISOString());
  assert.equal(billingPhase(overview, graceEnd - 1), "grace");
  assert.equal(billingPhase(overview, graceEnd), "restricted");
  const access = getBillingAccess(overview, graceEnd);
  assert.equal(access.effectivePlan, "start");
  assert.equal(access.canStartLease, false);
  assert.equal(access.canCreateRepairs, false);
});

test("grace preserves a paid team even when an earlier trial is still active", () => {
  const overview = {
    ...base,
    mode: "enforced" as const,
    plan: "team" as const,
    paid_until: new Date(now - 1000).toISOString(),
    trial_until: new Date(now + 50000).toISOString(),
  };
  assert.equal(getBillingAccess(overview, now).effectivePlan, "team");
});

test("portfolio trial allows 20 units but no new team seats and has no unpaid grace", () => {
  const overview = {
    ...base,
    mode: "enforced" as const,
    units_used: 19,
    seats_used: 0,
    trial_until: new Date(now + 1).toISOString(),
  };
  const access = getBillingAccess(overview, now);
  assert.equal(access.effectivePlan, "portfolio");
  assert.equal(access.canCreateUnits, true);
  assert.equal(access.canInvite, false);
  assert.equal(getBillingAccess({ ...overview, units_used: 20 }, now).canCreateUnits, false);
  assert.equal(billingPhase(overview, now + 1), "restricted");
});

test("free access retains one unit and basic leases but no premium creation", () => {
  const access = getBillingAccess({ ...base, mode: "enforced", units_used: 1, seats_used: 0 }, now);
  assert.equal(access.phase, "free");
  assert.equal(access.canStartLease, true);
  assert.equal(access.canCreateUnits, false);
  assert.equal(access.canCreateExpenses, false);
});

test("limits preserve a current lease on an existing unit at the plan's exact capacity", () => {
  const overview = {
    ...base,
    mode: "enforced" as const,
    plan: "team" as const,
    units_used: 50,
    seats_used: 5,
    paid_until: new Date(now + 1000).toISOString(),
  };
  const access = getBillingAccess(overview, now);
  assert.equal(access.canStartLease, true);
  assert.equal(access.canCreateUnits, false);
  assert.equal(access.canInvite, false);
  assert.equal(getBillingAccess({ ...overview, units_used: 51 }, now).canStartLease, false);
});

test("response validation rejects missing dates, unknown modes and impossible counts", () => {
  assert.equal(parseBillingOverview(base).available, true);
  for (const invalid of [
    null,
    {},
    { ...base, mode: "active" },
    { ...base, plan: "enterprise" },
    { ...base, paid_until: "broken" },
    { ...base, seats_used: -1 },
    { ...base, units_used: 1.5 },
    { ...base, notice_until: undefined },
  ])
    assert.throws(() => parseBillingOverview(invalid));
});
