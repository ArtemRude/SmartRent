import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDeposit, parseHandoverMoney, type LeaseHandover } from "../src/lib/handovers.ts";
import { buildHandoverHtml } from "../src/lib/handover-report.ts";

test("deposit calculation preserves kopecks and separates the refund from deductions", () => {
  assert.deepEqual(
    calculateDeposit(30000, [
      { reason: "Уборка", amount: 1000.1 },
      { reason: "Повреждение", amount: 2500.25 },
    ]),
    { deposit: 30000, retained: 3500.35, refund: 26499.65 },
  );
  assert.deepEqual(calculateDeposit(0.3, [{ reason: "Проверка", amount: 0.1 }]), {
    deposit: 0.3,
    retained: 0.1,
    refund: 0.2,
  });
});
test("empty deposits and full withholding produce a zero refund", () => {
  assert.equal(calculateDeposit(0, []).refund, 0);
  assert.equal(calculateDeposit(30000, [{ reason: "Восстановление", amount: 30000 }]).refund, 0);
});
test("invalid, unreasoned and excessive deductions cannot produce a refund", () => {
  for (const value of [-1, NaN, Infinity, 1_000_000_000, 0.001])
    assert.throws(() => calculateDeposit(value, []));
  assert.throws(() => calculateDeposit(100, [{ reason: " ", amount: 1 }]));
  assert.throws(() => calculateDeposit(100, [{ reason: "Ущерб", amount: 101 }]));
});
test("money inputs accept Russian kopecks and reject exponent, signs and excessive precision", () => {
  assert.equal(parseHandoverMoney(" 30000,10 "), 30000.1);
  for (const value of ["", "-10", "1e3", "Infinity", "0.001", "1000000000"])
    assert.equal(parseHandoverMoney(value), null);
});
const report = {
  id: "report",
  agreement_id: "lease",
  kind: "move_out",
  revision: 4,
  status: "pending",
  inspection_date: "2026-10-20",
  keys_count: 2,
  checklist: { condition: true, inventory: true, meters: true, keys: true },
  inventory_snapshot: [{ name: "Диван", quantity: "1", condition: "Исправен" }],
  condition_note: "Без повреждений",
  meter_readings: "Вода 100",
  photos: [],
  deposit_received: 30000,
  deductions: [{ reason: "Уборка", amount: 1000.1 }],
  deductions_total: 1000.1,
  refund_due: 28999.9,
  review_note: null,
  reviewed_at: null,
  submitted_at: "2026-10-20T12:00:00Z",
  refund_marked_at: null,
  refund_confirmed_at: null,
  completed_at: null,
} as LeaseHandover;
const context = { property: "Квартира", address: "Садовая, 12", tenant: "Иван" };
test("printed handover distinguishes a calculation from actual receipt and keeps the inventory snapshot", () => {
  const html = buildHandoverHtml(report, context);
  assert.match(html, /Акт выезда/);
  assert.match(html, /Диван/);
  assert.match(html, /28\s999,90/);
  assert.match(html, /Получение подтверждено арендатором: Нет/);
  assert.match(html, /Ожидает арендатора/);
});
test("inspection notes, deduction reasons and parties cannot inject HTML into the act", () => {
  const html = buildHandoverHtml(
    {
      ...report,
      condition_note: '<img src=x onerror="alert(1)">',
      deductions: [{ reason: "<script>alert(1)</script>", amount: 1 }],
    },
    { ...context, tenant: "<iframe>" },
  );
  assert.doesNotMatch(html, /<img|<script|<iframe/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
});
