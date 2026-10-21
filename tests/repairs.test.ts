import test from "node:test";
import assert from "node:assert/strict";
import { buildRepairEstimate, repairAmount, repairOverdue } from "../src/lib/repairs.ts";
test("repair quote rounds each line to kopecks before summing", () => {
  const result = buildRepairEstimate([
    { name: " Labour ", quantity: "1,5", unit_price: "100,11" },
    { name: "Parts", quantity: "2", unit_price: "0,10" },
  ]);
  assert.equal(result.items[0]!.amount, 150.17);
  assert.equal(result.total, 150.37);
  assert.equal(result.items[0]!.name, "Labour");
  assert.equal(
    buildRepairEstimate([{ name: "Half kopeck", quantity: "0.5", unit_price: "0.01" }]).total,
    0.01,
  );
});
test("repair quote rejects invalid numbers, empty lines and oversized totals", () => {
  for (const input of ["NaN", "Infinity", "1e3", "-1", "1.123", ""]) {
    assert.throws(() => repairAmount(input));
    assert.throws(() => buildRepairEstimate([{ name: "Work", quantity: input, unit_price: "1" }]));
  }
  assert.throws(() => buildRepairEstimate([]));
  assert.throws(() => buildRepairEstimate([{ name: "", quantity: "1", unit_price: "1" }]));
  assert.throws(() =>
    buildRepairEstimate([{ name: "Large", quantity: "10000", unit_price: "999999999.99" }]),
  );
  assert.equal(repairAmount("12345,67"), 12345.67);
});
test("finished and cancelled repairs are not overdue", () => {
  assert.equal(repairOverdue({ status: "review", due_date: "2026-10-20" }, "2026-10-21"), true);
  assert.equal(
    repairOverdue({ status: "in_progress", due_date: "2026-10-21" }, "2026-10-21"),
    false,
  );
  assert.equal(repairOverdue({ status: "completed", due_date: "2026-10-20" }, "2026-10-21"), false);
  assert.equal(repairOverdue({ status: "cancelled", due_date: "2026-10-20" }, "2026-10-21"), false);
});
