import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enrichAgreementTerms,
  nextRentMonth,
  rentAt,
  type LeaseAmendment,
} from "../src/lib/lease-changes.ts";
import { buildLeaseChangeHtml } from "../src/lib/lease-change-report.ts";
import { buildRentForecast } from "../src/lib/rent-forecast.ts";
const proposal = {
  id: "change",
  agreement_id: "lease",
  status: "accepted",
  revision: 3,
  effective_from: "2026-11-01",
  monthly_payment: 65000.25,
  end_date: "2027-04-30",
  previous_monthly_payment: 60000,
  previous_end_date: "2027-01-31",
  note: "New terms",
  review_note: null,
  agreement_snapshot: {
    start_date: "2026-01-01",
    property_name: "Flat",
    tenant_name: "Tenant",
    owner_name: "Owner",
  },
  submitted_at: "2026-10-21T12:00:00Z",
  decided_at: "2026-10-21T13:00:00Z",
  created_at: "",
  updated_at: "",
} satisfies LeaseAmendment;
test("scheduled rates begin in their own month, preserving the original and prior steps", () => {
  const a = {
    monthly_payment: 60000,
    rent_schedule: [
      { effective_from: "2026-12-01", monthly_payment: 64000 },
      { effective_from: "2026-11-01", monthly_payment: 65000.25 },
    ],
  };
  assert.equal(rentAt(a, "2026-10-21"), 60000);
  assert.equal(rentAt(a, "2026-11-01"), 65000.25);
  assert.equal(rentAt(a, "2026-11-30"), 65000.25);
  assert.equal(rentAt(a, "2026-12-01"), 64000);
  assert.equal(rentAt({ monthly_payment: 5000 }, "2026-11"), 5000);
  assert.equal(nextRentMonth("2026-12-21"), "2027-01-01");
});
test("only accepted proposals enrich rates; original end date and locking survive later renewals", () => {
  const [a] = enrichAgreementTerms(
    [{ id: "lease", end_date: "2028-01-31" }],
    [
      { ...proposal, id: "pending", status: "pending" },
      {
        ...proposal,
        id: "later",
        effective_from: "2027-01-01",
        previous_end_date: "2027-04-30",
        end_date: "2028-01-31",
      },
      proposal,
    ],
  );
  assert.equal(a!.rent_schedule.length, 2);
  assert.equal(a!.original_end_date, "2027-01-31");
  assert.equal(a!.terms_locked, true);
  const [draft] = enrichAgreementTerms(
    [{ id: "lease", end_date: "2027-01-31" }],
    [{ ...proposal, status: "draft" }],
  );
  assert.equal(draft!.terms_locked, false);
  assert.deepEqual(draft!.rent_schedule, []);
});
test("rent forecast uses each approved future rate, including the extension", () => {
  const forecast = buildRentForecast({
    agreements: [
      {
        id: "lease",
        status: "active",
        startDate: "2026-01-01",
        endDate: "2027-04-30",
        monthlyPayment: 60000,
        rentSchedule: [
          { effective_from: "2026-11-01", monthly_payment: 65000.25 },
          { effective_from: "2026-12-01", monthly_payment: 64000 },
        ],
        propertyId: "flat",
        propertyName: "Flat",
        tenantId: "tenant",
        tenantName: "Tenant",
      },
    ],
    startPeriod: "2026-10",
    horizonMonths: 3,
  });
  assert.deepEqual(
    forecast.months.map((m) => m.expected),
    [60000, 65000.25, 64000],
  );
  assert.equal(forecast.totalExpected, 189000.25);
});
test("printable addendum preserves precise terms and distinguishes acknowledgement from a signed PDF", () => {
  const html = buildLeaseChangeHtml(proposal);
  assert.match(html, /Дополнительное соглашение/);
  assert.match(html, /65\s000,25/);
  assert.match(html, /не является отметкой о подписании PDF/);
  assert.match(html, /Согласовано/);
  const hostile = buildLeaseChangeHtml({
    ...proposal,
    note: "<script>alert(1)</script>",
    agreement_snapshot: { property_name: '<img src=x onerror="alert(1)">' },
  });
  assert.doesNotMatch(hostile, /<script|<img/);
  assert.match(hostile, /&lt;script/);
});
