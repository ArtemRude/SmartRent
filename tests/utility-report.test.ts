import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildUtilityHistoryCsv,
  buildUtilityReportHtml,
  type UtilityReportData,
} from "../src/lib/utility-report.ts";

const data: UtilityReportData = {
  propertyName: "Квартира на Садовой",
  propertyAddress: "Садовая, 12",
  tenantName: "Иван",
  unitName: null,
  bill: {
    id: "bill",
    agreement_id: "lease",
    period_start: "2026-10-01",
    status: "approved",
    amount: 636.8,
    submitted_by: "tenant",
    reviewed_by: "owner",
    reviewed_at: "2026-10-14T12:00:00Z",
    review_note: null,
    charge_id: "charge",
    created_at: "2026-10-14T10:00:00Z",
  },
  items: [
    {
      id: "water",
      bill_id: "bill",
      service_id: "service-water",
      name: "Холодная вода",
      kind: "meter",
      unit: "м³",
      previous_reading: 100,
      reading: 103.2,
      rate: 42.75,
      amount: 136.8,
      photo_path: null,
    },
    {
      id: "internet",
      bill_id: "bill",
      service_id: "service-internet",
      name: "Интернет",
      kind: "fixed",
      unit: "мес.",
      previous_reading: null,
      reading: null,
      rate: 500,
      amount: 500,
      photo_path: null,
    },
  ],
  charge: {
    id: "charge",
    agreement_id: "lease",
    period_start: "2026-10-01",
    amount: 636.8,
    paid_amount: 100,
    paid_at: null,
    due_date: "2026-10-21",
  },
};

test("printable report uses stored line items and shows the partial payment balance", () => {
  const html = buildUtilityReportHtml({
    ...data,
    items: [
      ...data.items,
      { ...data.items[0]!, id: "other", bill_id: "other", name: "НЕ ДОЛЖНО ПОПАСТЬ" },
    ],
  });
  assert.match(html, /136,80/);
  assert.match(html, /636,80/);
  assert.match(html, /536,80/);
  assert.match(html, /100 → 103,2/);
  assert.match(html, /42,75/);
  assert.match(html, /Арендная плата начисляется отдельно/);
  assert.doesNotMatch(html, /НЕ ДОЛЖНО ПОПАСТЬ/);
});

test("user-controlled text cannot inject markup into the report", () => {
  const html = buildUtilityReportHtml({
    ...data,
    propertyName: '<img src=x onerror="alert(1)">',
    tenantName: "<script>alert(2)</script>",
    bill: { ...data.bill, review_note: "</p><script>alert(3)</script>" },
    items: [{ ...data.items[0]!, name: '<svg onload="alert(4)">' }],
  });
  assert.doesNotMatch(html, /<script>|<img|<svg/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});

test("pending and rejected reports clearly distinguish calculation from actual billing", () => {
  assert.match(
    buildUtilityReportHtml({
      ...data,
      bill: { ...data.bill, status: "pending" },
      charge: undefined,
    }),
    /Предварительный расчёт/,
  );
  assert.match(
    buildUtilityReportHtml({
      ...data,
      bill: { ...data.bill, status: "rejected" },
      charge: undefined,
    }),
    /начисление не создано/,
  );
});

test("CSV exports snapshots, keeps review status and prevents spreadsheet formula injection", () => {
  const csv = buildUtilityHistoryCsv(
    [{ ...data.bill, review_note: ' =HYPERLINK("https://example.invalid")' }],
    [{ ...data.items[0]!, name: "=1+1" }, data.items[1]!],
  );
  assert.match(csv, /Утверждено/);
  assert.match(csv, /136,80/);
  assert.match(csv, /42,75/);
  assert.match(csv, /;'=1\+1;/);
  assert.match(csv, /' =HYPERLINK/);
  assert.equal(buildUtilityHistoryCsv([], data.items).split("\r\n").length, 1);
});
