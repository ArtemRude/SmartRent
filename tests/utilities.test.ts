import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatUtilityMoney,
  parseUtilityNumber,
  previousUtilityReading,
  utilityLineAmount,
  type UtilityBill,
  type UtilityBillItem,
  type UtilityService,
} from "../src/lib/utilities.ts";

test("utility amounts round each meter line to kopecks without floating point drift", () => {
  assert.equal(utilityLineAmount(100.1, 103.3, 42.75), 136.8);
  assert.equal(utilityLineAmount(0.001, 0.006, 1), 0.01);
  assert.equal(utilityLineAmount(100, 100, 100.1234), 0);
  assert.equal(utilityLineAmount(100.002, 123.456, 6.1234), 143.62);
});

test("decreasing, negative and non-finite readings cannot create a preview", () => {
  assert.throws(() => utilityLineAmount(100, 99, 5));
  assert.throws(() => utilityLineAmount(-1, 10, 5));
  assert.throws(() => utilityLineAmount(0, 10, -1));
  assert.throws(() => utilityLineAmount(0, Number.NaN, 5));
  assert.throws(() => utilityLineAmount(0, 10, Number.POSITIVE_INFINITY));
  assert.throws(() => utilityLineAmount(0, 999_999_999, 99_999_999), /Сумма слишком большая/);
});

test("reading inputs accept Russian decimals and reject empty, signed or exponential values", () => {
  assert.equal(parseUtilityNumber(" 123,456 "), 123.456);
  assert.equal(parseUtilityNumber("0"), 0);
  for (const value of ["", " ", "-1", "+1", "1e3", "1,2.3", "NaN", "Infinity", "1000000000"]) {
    assert.equal(parseUtilityNumber(value), null, value);
  }
});

test("the baseline comes from the latest approved period, excluding pending and rejected readings", () => {
  const service = { id: "water", initial_reading: 100 } as UtilityService;
  const bills = [
    { id: "old", status: "approved", period_start: "2026-08-01" },
    { id: "latest", status: "approved", period_start: "2026-09-01" },
    { id: "rejected", status: "rejected", period_start: "2026-10-01" },
    { id: "pending", status: "pending", period_start: "2026-10-01" },
  ] as UtilityBill[];
  const items = [
    { service_id: "water", bill_id: "old", reading: 110 },
    { service_id: "water", bill_id: "latest", reading: 120 },
    { service_id: "water", bill_id: "rejected", reading: 999 },
    { service_id: "water", bill_id: "pending", reading: 998 },
    { service_id: "electricity", bill_id: "latest", reading: 2000 },
  ] as UtilityBillItem[];
  assert.equal(previousUtilityReading(service, bills, items), 120);
  assert.equal(previousUtilityReading(service, [], []), 100);
});

test("utility currency displays kopecks", () => {
  assert.match(formatUtilityMoney(136.8), /136,80/);
});
