import assert from "node:assert/strict";
import test from "node:test";
import { buildPaymentAnalytics, sumPaymentsForMonth } from "../src/lib/payment-analytics.ts";

test("buildPaymentAnalytics aggregates months and properties", () => {
  const result = buildPaymentAnalytics([
    {
      amount: 65_000,
      paid: true,
      period: "2026-06",
      propertyId: "flat",
      propertyName: "Квартира",
    },
    {
      amount: 65_000,
      paid: false,
      period: "2026-07",
      propertyId: "flat",
      propertyName: "Квартира",
    },
    {
      amount: 120_000,
      paid: false,
      period: "2026-06",
      propertyId: "office",
      propertyName: "Офис",
    },
  ]);

  assert.equal(result.accrued, 250_000);
  assert.equal(result.paid, 65_000);
  assert.equal(result.unpaid, 185_000);
  assert.equal(result.collectionRate, 26);
  assert.deepEqual(result.months, [
    { period: "2026-06", accrued: 185_000, paid: 65_000 },
    { period: "2026-07", accrued: 65_000, paid: 0 },
  ]);
  assert.deepEqual(result.properties, [
    { propertyId: "flat", propertyName: "Квартира", accrued: 130_000, paid: 65_000 },
    { propertyId: "office", propertyName: "Офис", accrued: 120_000, paid: 0 },
  ]);
});

test("buildPaymentAnalytics handles an empty selection", () => {
  assert.deepEqual(buildPaymentAnalytics([]), {
    accrued: 0,
    paid: 0,
    unpaid: 0,
    collectionRate: 0,
    months: [],
    properties: [],
  });
});

test("buildPaymentAnalytics includes partial payments", () => {
  const result = buildPaymentAnalytics([
    {
      amount: 60_000,
      paidAmount: 25_000,
      period: "2026-09",
      propertyId: "flat",
      propertyName: "Квартира",
    },
  ]);

  assert.equal(result.paid, 25_000);
  assert.equal(result.unpaid, 35_000);
  assert.equal(result.collectionRate, 42);
});

test("sumPaymentsForMonth uses actual partial payments from the selected month", () => {
  const result = sumPaymentsForMonth(
    [
      { amount: 10_000, paid_at: "2026-09-03T12:00:00.000Z" },
      { amount: 7_500, paid_at: "2026-09-18T12:00:00.000Z" },
      { amount: 50_000, paid_at: "2026-08-31T12:00:00.000Z" },
    ],
    "2026-09",
  );

  assert.equal(result, 17_500);
});
