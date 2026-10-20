import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRentalOnboarding, getAgreementPreparation } from "../src/lib/rental-onboarding.ts";

const draft = {
  id: "lease",
  status: "draft" as const,
  status_changed_at: "2026-10-20T12:00:00Z",
  signed_document_file: null,
  tenant_id: "tenant",
  property_id: "property",
};
const pending = { ...draft, status: "pending_signature" as const };
const accepted = { agreement_id: draft.id, agreement_version: draft.status_changed_at };
const input = {
  properties: [{ id: "property" }],
  tenants: [{ id: "tenant", user_id: "tenant-user" }],
  agreements: [draft],
  acceptances: [],
  charges: [],
};

test("empty setup starts with the first property and all six steps remain incomplete", () => {
  const steps = buildRentalOnboarding({
    properties: [],
    tenants: [],
    agreements: [],
    acceptances: [],
    charges: [],
  });
  assert.equal(steps.length, 6);
  assert.equal(steps.filter((step) => step.completed).length, 0);
  assert.equal(steps.find((step) => !step.completed)?.to, "/properties");
});

test("a draft cannot complete preparation, activation or first billing", () => {
  const steps = buildRentalOnboarding(input);
  assert.equal(steps.filter((step) => step.completed).length, 3);
  assert.equal(steps.find((step) => !step.completed)?.title, "Подготовьте подписание");
  assert.deepEqual(steps[3]?.search, { agreementId: "lease" });
});

test("activation needs a linked tenant, current acceptance and the signed document", () => {
  const prepared = { ...pending, signed_document_file: "owner/signed.pdf" };
  assert.equal(getAgreementPreparation(prepared, "tenant-user", [accepted]).canActivate, true);
  assert.equal(getAgreementPreparation(prepared, null, [accepted]).canActivate, false);
  assert.equal(getAgreementPreparation(pending, "tenant-user", [accepted]).canActivate, false);
  assert.equal(
    getAgreementPreparation({ ...prepared, status: "draft" }, "tenant-user", [accepted])
      .canActivate,
    false,
  );
});

test("acceptance of a previous version or another agreement never unlocks activation", () => {
  const prepared = { ...pending, signed_document_file: "owner/signed.pdf" };
  for (const acceptance of [
    { ...accepted, agreement_version: "old" },
    { ...accepted, agreement_id: "other" },
  ]) {
    const result = getAgreementPreparation(prepared, "tenant-user", [acceptance]);
    assert.equal(result.canActivate, false);
    assert.equal(result.nextStep?.id, "accepted");
  }
});

test("ready-to-activate setup directs the owner to activation of the same contract", () => {
  const steps = buildRentalOnboarding({
    ...input,
    agreements: [{ ...pending, signed_document_file: "signed.pdf" }],
    acceptances: [accepted],
  });
  assert.equal(steps.filter((step) => step.completed).length, 4);
  assert.equal(steps.find((step) => !step.completed)?.title, "Активируйте договор");
  assert.deepEqual(steps.find((step) => !step.completed)?.search, { agreementId: "lease" });
});

test("utility charges and rent charges for another contract cannot finish first billing", () => {
  const steps = buildRentalOnboarding({
    ...input,
    agreements: [{ ...draft, status: "active" }],
    charges: [
      { agreement_id: draft.id, charge_type: "utilities" },
      { agreement_id: "other", charge_type: "rent" },
    ],
  });
  assert.equal(steps.filter((step) => step.completed).length, 5);
  assert.equal(steps.find((step) => !step.completed)?.to, "/payments");
});

test("a launched legacy agreement with rent billing completes setup despite other drafts", () => {
  const steps = buildRentalOnboarding({
    ...input,
    agreements: [draft, { ...draft, id: "launched", status: "active" }],
    charges: [{ agreement_id: "launched" }],
  });
  assert.ok(steps.every((step) => step.completed));
  assert.deepEqual(steps[4]?.search, { agreementId: "launched" });
});

test("setup cannot combine unrelated property and tenant records into one completed lease", () => {
  const steps = buildRentalOnboarding({
    ...input,
    properties: [{ id: "other" }],
    tenants: [{ id: "other", user_id: "other-user" }],
  });
  assert.equal(steps[0]?.completed, false);
  assert.equal(steps[1]?.completed, false);
});

test("a completed agreement doesn't restart first-time setup when its billing exists", () => {
  const steps = buildRentalOnboarding({
    ...input,
    agreements: [{ ...draft, status: "completed" }],
    charges: [{ agreement_id: draft.id, charge_type: "rent" }],
  });
  assert.ok(steps.every((step) => step.completed));
});
