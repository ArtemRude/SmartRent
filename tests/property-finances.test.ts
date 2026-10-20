import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPropertyFinances,
  financeMonths,
  parseExpenseAmount,
  type PropertyExpense,
} from "../src/lib/property-finances.ts";
const expense = {
  id: "e",
  property_id: "a",
  title: "Repair",
  category: "repair",
  planned_date: "2026-09-10",
  planned_amount: 2000,
  status: "paid",
  paid_date: "2026-10-10",
  paid_amount: 2500.25,
  receipt_file: null,
  note: "",
  revision: 1,
  created_at: "",
  updated_at: "",
} satisfies PropertyExpense;
const input = {
  properties: [
    { id: "a", name: "Квартира" },
    { id: "b", name: "Пустой объект" },
  ],
  agreements: [{ id: "lease", property_id: "a" }],
  charges: [
    {
      id: "rent",
      agreement_id: "lease",
      amount: 10000,
      adjustment_amount: -500,
      period_start: "2026-09-01",
      charge_type: "rent" as const,
      paid_amount: 9000,
    },
    {
      id: "water",
      agreement_id: "lease",
      amount: 1500,
      adjustment_amount: 0,
      period_start: "2026-10-01",
      charge_type: "utilities" as const,
      paid_amount: 1500,
    },
  ],
  payments: [
    { id: "p1", charge_id: "rent", amount: 3000, paid_at: "2026-09-10T12:00:00Z" },
    { id: "p2", charge_id: "rent", amount: 6000, paid_at: "2026-10-10T12:00:00Z" },
    { id: "waterp", charge_id: "water", amount: 1500, paid_at: "2026-10-10T12:00:00Z" },
  ],
  expenses: [
    expense,
    {
      ...expense,
      id: "b-expense",
      property_id: "b",
      planned_date: "2026-10-01",
      planned_amount: 100,
      paid_amount: 100,
    },
  ],
  paymentsAvailable: true,
  from: "2026-09",
  to: "2026-10",
};
test("income follows partial payment dates; utilities are excluded and adjusted rent is the plan", () => {
  const result = buildPropertyFinances(input);
  assert.equal(result.actualComplete, true);
  assert.equal(result.totals.income, 9000);
  assert.equal(result.totals.plannedIncome, 9500);
  assert.equal(result.months[0]!.income, 3000);
  assert.equal(result.months[1]!.income, 6000);
  assert.equal(result.months[0]!.plannedExpenses, 2000);
  assert.equal(result.months[0]!.expenses, 0);
  assert.equal(result.months[1]!.plannedExpenses, 100);
  assert.equal(result.months[1]!.expenses, 2600.25);
  assert.equal(result.totals.result, 6399.75);
  assert.equal(result.properties.find((p) => p.id === "b")!.result, -100);
});
test("plan stays in original month while payment and overspend belong to payment month", () => {
  const result = buildPropertyFinances({ ...input, from: "2026-10", propertyId: "a" });
  assert.equal(result.totals.plannedIncome, 0);
  assert.equal(result.totals.plannedExpenses, 0);
  assert.equal(result.totals.income, 6000);
  assert.equal(result.totals.expenses, 2500.25);
  assert.equal(result.totals.result, 3499.75);
});
test("cancelled expenses do not affect plan or fact and unpaid plans never become actual expenses", () => {
  const result = buildPropertyFinances({
    ...input,
    expenses: [
      { ...expense, status: "cancelled", paid_date: null, paid_amount: null },
      { ...expense, id: "planned", status: "planned", paid_date: null, paid_amount: null },
    ],
  });
  assert.equal(result.totals.expenses, 0);
  assert.equal(result.totals.plannedExpenses, 2000);
});
test("missing ledger, unmatched payments and mismatched totals cannot look like complete profit", () => {
  assert.equal(buildPropertyFinances({ ...input, paymentsAvailable: false }).actualComplete, false);
  assert.equal(buildPropertyFinances({ ...input, payments: [] }).actualComplete, false);
  assert.equal(
    buildPropertyFinances({
      ...input,
      payments: [
        ...input.payments,
        { id: "foreign", charge_id: "missing", amount: 1, paid_at: "2026-10-01" },
      ],
    }).actualComplete,
    false,
  );
});
test("kopecks remain precise and duplicate payment rows do not double count", () => {
  const result = buildPropertyFinances({
    ...input,
    charges: [{ ...input.charges[0]!, amount: 0.3, adjustment_amount: 0, paid_amount: 0.3 }],
    payments: [
      { id: "one", charge_id: "rent", amount: 0.1, paid_at: "2026-10-01" },
      { id: "two", charge_id: "rent", amount: 0.2, paid_at: "2026-10-01" },
      { id: "two", charge_id: "rent", amount: 0.2, paid_at: "2026-10-01" },
    ],
    expenses: [{ ...expense, planned_amount: 0.1, paid_amount: 0.1 }],
  });
  assert.equal(result.totals.income, 0.3);
  assert.equal(result.totals.result, 0.2);
  assert.equal(result.actualComplete, true);
});
test("invalid ranges and invalid expense amounts are rejected", () => {
  assert.deepEqual(financeMonths("2026-12", "2027-02"), ["2026-12", "2027-01", "2027-02"]);
  for (const pair of [
    ["2026-02", "2026-01"],
    ["2026-00", "2026-02"],
    ["2024-01", "2026-01"],
    ["x", "2026-01"],
  ])
    assert.deepEqual(financeMonths(pair[0]!, pair[1]!), []);
  assert.equal(parseExpenseAmount(" 25,10 "), 25.1);
  for (const value of ["0", "-10", "NaN", "Infinity", "1e4", "0.001", "1000000000"])
    assert.equal(parseExpenseAmount(value), null);
});
