import assert from "node:assert/strict";
import test from "node:test";
import { buildRentForecast, type ForecastAgreement } from "../src/lib/rent-forecast.ts";

const agreements: ForecastAgreement[] = [
  {
    id: "long",
    status: "active",
    startDate: "2026-01-01",
    endDate: "2027-12-31",
    monthlyPayment: 65_000,
    propertyId: "flat",
    propertyName: "Квартира",
    tenantId: "tenant-one",
    tenantName: "Анна",
  },
  {
    id: "ending",
    status: "active",
    startDate: "2026-10-15",
    endDate: "2026-11-20",
    monthlyPayment: 100_000,
    propertyId: "office",
    propertyName: "Офис",
    tenantId: "tenant-two",
    tenantName: "Компания",
  },
  {
    id: "archived",
    status: "archived",
    startDate: "2026-01-01",
    endDate: "2027-12-31",
    monthlyPayment: 500_000,
    propertyId: "old",
    propertyName: "Архив",
    tenantId: "tenant-three",
    tenantName: "Бывший арендатор",
  },
];

test("buildRentForecast follows active agreement dates and monthly rates", () => {
  const result = buildRentForecast({ agreements, startPeriod: "2026-09", horizonMonths: 3 });

  assert.deepEqual(result.months, [
    { period: "2026-09", expected: 65_000, activeContracts: 1 },
    { period: "2026-10", expected: 165_000, activeContracts: 2 },
    { period: "2026-11", expected: 165_000, activeContracts: 2 },
  ]);
  assert.equal(result.totalExpected, 395_000);
  assert.equal(result.expiringContracts, 1);
  assert.deepEqual(
    result.contracts.map((contract) => contract.id),
    ["ending", "long"],
  );
});

test("buildRentForecast returns empty months without matching contracts", () => {
  const result = buildRentForecast({ agreements: [], startPeriod: "2026-09", horizonMonths: 3 });

  assert.equal(result.totalExpected, 0);
  assert.equal(result.expiringContracts, 0);
  assert.deepEqual(result.months, [
    { period: "2026-09", expected: 0, activeContracts: 0 },
    { period: "2026-10", expected: 0, activeContracts: 0 },
    { period: "2026-11", expected: 0, activeContracts: 0 },
  ]);
});
