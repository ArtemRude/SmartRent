import assert from "node:assert/strict";
import test from "node:test";
import { buildDebtGroups } from "../src/lib/debt-center.ts";

test("buildDebtGroups combines overdue charges by agreement and prioritizes amount", () => {
  const result = buildDebtGroups(
    [
      {
        chargeId: "charge-one",
        agreementId: "agreement-one",
        propertyName: "Квартира",
        tenantName: "Анна",
        amount: 65_000,
        dueDate: "2026-07-05",
      },
      {
        chargeId: "charge-two",
        agreementId: "agreement-one",
        propertyName: "Квартира",
        tenantName: "Анна",
        amount: 65_000,
        dueDate: "2026-08-05",
      },
      {
        chargeId: "charge-three",
        agreementId: "agreement-two",
        propertyName: "Офис",
        tenantName: "Компания",
        amount: 100_000,
        dueDate: "2026-09-01",
      },
    ],
    "2026-09-09",
  );

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    agreementId: "agreement-one",
    propertyName: "Квартира",
    tenantName: "Анна",
    total: 130_000,
    overdueCount: 2,
    oldestDueDate: "2026-07-05",
    daysOverdue: 66,
    chargeIds: ["charge-one", "charge-two"],
  });
  assert.equal(result[1]?.daysOverdue, 8);
});

test("buildDebtGroups handles an empty debt list", () => {
  assert.deepEqual(buildDebtGroups([], "2026-09-09"), []);
});
