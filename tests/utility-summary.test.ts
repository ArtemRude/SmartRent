import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildUtilityMonthlySummary,
  type UtilitySummaryCharge,
} from "../src/lib/utility-summary.ts";
import type { UtilityBill } from "../src/lib/utilities.ts";

const rent: UtilitySummaryCharge = {
  id: "rent",
  agreement_id: "lease",
  period_start: "2026-10-01",
  amount: 30000,
  charge_type: "rent",
  paid_amount: 5000,
  paid_at: null,
};
const utility: UtilitySummaryCharge = {
  ...rent,
  id: "utility",
  charge_type: "utilities",
  amount: 636.8,
  paid_amount: 100,
};
const approved = {
  id: "approved",
  agreement_id: "lease",
  period_start: "2026-10-01",
  status: "approved",
  amount: 636.8,
  charge_id: "utility",
} as UtilityBill;
const summary = (charges: UtilitySummaryCharge[], bills: UtilityBill[], previewAmount?: number) =>
  buildUtilityMonthlySummary({
    agreementId: "lease",
    period: "2026-10",
    charges,
    bills,
    previewAmount,
  });

test("monthly summary uses actual charges and subtracts partial payments", () => {
  const result = summary(
    [
      rent,
      utility,
      { ...rent, id: "other-lease", agreement_id: "other", amount: 99999 },
      { ...rent, id: "other-month", period_start: "2026-09-01", amount: 99999 },
    ],
    [approved],
  );
  assert.equal(result.rentTotal, 30000);
  assert.equal(result.utilityTotal, 636.8);
  assert.equal(result.total, 30636.8);
  assert.equal(result.paid, 5100);
  assert.equal(result.remaining, 25536.8);
  assert.equal(result.state, "approved");
});

test("pending utilities affect the projected total but never the outstanding balance", () => {
  const result = summary([rent], [{ ...approved, status: "pending", charge_id: null }]);
  assert.equal(result.total, 30636.8);
  assert.equal(result.remaining, 25000);
  assert.equal(result.paid, 5000);
  assert.equal(result.state, "pending");
});

test("rejected versions cannot duplicate an approved total", () => {
  const result = summary(
    [rent, utility],
    [{ ...approved, id: "rejected", status: "rejected", amount: 99999 }, approved],
  );
  assert.equal(result.utilityTotal, 636.8);
  assert.equal(result.total, 30636.8);
});

test("unknown utilities are distinct from an approved zero-consumption bill", () => {
  assert.equal(summary([rent], []).utilityTotal, null);
  assert.equal(summary([rent], []).total, null);
  const zero = summary([rent], [{ ...approved, amount: 0, charge_id: null }]);
  assert.equal(zero.utilityTotal, 0);
  assert.equal(zero.total, 30000);
  assert.equal(zero.state, "approved");
});

test("missing charge data does not imply a zero balance on an approved nonzero bill", () => {
  const result = summary([rent], [approved]);
  assert.equal(result.remaining, null);
  assert.equal(result.paid, null);
});

test("draft calculations are labelled as estimates and account for legacy paid rent", () => {
  const { paid_amount: _paid, ...legacy } = rent;
  const result = summary([{ ...legacy, paid_at: "2026-10-01T12:00:00Z" }], [], 636.8);
  assert.equal(result.state, "estimate");
  assert.equal(result.total, 30636.8);
  assert.equal(result.remaining, 0);
  assert.equal(result.paid, 30000);
  assert.equal(summary([], [], 0).rentTotal, null);
});
