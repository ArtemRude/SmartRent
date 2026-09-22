import assert from "node:assert/strict";
import test from "node:test";
import { buildPropertyTimeline } from "../src/lib/property-timeline.ts";

const agreement = {
  id: "agreement-1",
  created_at: "2026-09-01T10:00:00Z",
  owner_id: "owner-1",
  property_id: "property-1",
  unit_id: "unit-1",
  tenant_id: "tenant-1",
  start_date: "2026-09-01",
  end_date: "2027-08-31",
  monthly_payment: 40_000,
  payment_due_day: 20,
  status: "active" as const,
  document_file: null,
  signed_document_file: null,
  signed_at: null,
  status_changed_at: "2026-09-02T10:00:00Z",
  contract_details: {},
};

test("property timeline merges and sorts events from existing sources", () => {
  const timeline = buildPropertyTimeline({
    propertyEvents: [
      {
        id: "property-event-1",
        property_id: "property-1",
        actor_id: "owner-1",
        event_type: "property_updated",
        entity_type: "property",
        entity_id: "property-1",
        title: "Параметры объекта изменены",
        details: { fields: ["Адрес"] },
        created_at: "2026-09-05T10:00:00Z",
      },
    ],
    agreementEvents: [
      {
        id: "agreement-event-1",
        agreement_id: "agreement-1",
        from_status: null,
        to_status: "draft",
        changed_by: "owner-1",
        created_at: "2026-09-01T10:00:00Z",
      },
    ],
    agreementAcceptances: [],
    requestEvents: [],
    charges: [
      {
        id: "charge-1",
        agreement_id: "agreement-1",
        owner_id: "owner-1",
        tenant_id: "tenant-1",
        period_start: "2026-09-01",
        due_date: "2026-09-20",
        amount: 40_000,
        adjustment_amount: 0,
        adjustment_reason: null,
        adjusted_at: null,
        adjusted_by: null,
        paid_at: "2026-09-04T10:00:00Z",
        paid_amount: 40_000,
        payment_note: null,
        created_at: "2026-09-01T10:00:00Z",
      },
    ],
    payments: [
      {
        id: "payment-1",
        charge_id: "charge-1",
        owner_id: "owner-1",
        tenant_id: "tenant-1",
        amount: 40_000,
        paid_at: "2026-09-04T10:00:00Z",
        payment_method: "bank_transfer",
        note: null,
        receipt_file: null,
        created_by: "owner-1",
        created_at: "2026-09-04T10:00:00Z",
      },
    ],
    agreements: [agreement],
    requests: [],
    tenants: [
      {
        id: "tenant-1",
        owner_id: "owner-1",
        name: "Иван Иванов",
        email: "ivan@example.com",
        phone: null,
        user_id: null,
        created_at: "2026-08-01T10:00:00Z",
      },
    ],
    units: [
      { id: "unit-1", property_id: "property-1", name: "Квартира 1", area: 50, status: "occupied" },
    ],
  });

  assert.deepEqual(
    timeline.map((event) => event.kind),
    ["property", "payment", "agreement"],
  );
  assert.equal(timeline[1]?.title, "Получена оплата 40 000 ₽");
  assert.equal(timeline[1]?.description, "Иван Иванов · Квартира 1");
});

test("initial request status is not duplicated", () => {
  const request = {
    id: "request-1",
    owner_id: "owner-1",
    tenant_id: "tenant-1",
    property_id: "property-1",
    unit_id: null,
    title: "Проверить кран",
    description: "",
    category: "repair" as const,
    status: "new" as const,
    photo: null,
    created_at: "2026-09-03T10:00:00Z",
  };
  const timeline = buildPropertyTimeline({
    propertyEvents: [],
    agreementEvents: [],
    agreementAcceptances: [],
    requestEvents: [
      {
        id: "request-event-1",
        request_id: "request-1",
        from_status: null,
        to_status: "new",
        changed_by: null,
        created_at: request.created_at,
      },
    ],
    charges: [],
    payments: [],
    agreements: [],
    requests: [request],
    tenants: [],
    units: [],
  });

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0]?.title, "Создана заявка «Проверить кран»");
});
