import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchWorkspaceSearch,
  normalizeWorkspaceSearch,
  readWorkspaceSearch,
  workspaceSearchHref,
  type WorkspaceSearchItem,
} from "../src/lib/workspace-search.ts";

const uuid = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (values: Partial<WorkspaceSearchItem> = {}): WorkspaceSearchItem => ({
  kind: "property",
  id: uuid(1),
  title: "Квартира у парка",
  subtitle: "Садовая, 12",
  status: "active",
  property_id: uuid(1),
  agreement_id: null,
  access: "owner",
  ...values,
});

test("search normalizes whitespace and does not request invalid short/long queries", async () => {
  assert.equal(normalizeWorkspaceSearch("  Анна \n Миронова  "), "Анна Миронова");
  assert.equal(normalizeWorkspaceSearch("  %_  "), "%_");
  await assert.rejects(fetchWorkspaceSearch(" а "), /query_invalid/);
  await assert.rejects(fetchWorkspaceSearch("а".repeat(101)), /query_invalid/);
});

test("search rejects malformed responses, duplicates and overflow rather than trusting partial results", () => {
  assert.deepEqual(readWorkspaceSearch({ items: [item()], has_more: true }), {
    items: [item()],
    has_more: true,
  });
  for (const malformed of [
    null,
    { items: [] },
    { items: "empty", has_more: false },
    { items: [item({ id: "../admin" })], has_more: false },
    { items: [item(), item()], has_more: false },
    { items: [item({ access: "tenant" })], has_more: false },
    { items: [item({ kind: "tenant", access: "team" })], has_more: false },
    { items: [item({ kind: "request", access: "team", property_id: null })], has_more: false },
    { items: [item({ kind: "agreement", access: "team" })], has_more: false },
    { items: Array.from({ length: 11 }, (_, i) => item({ id: uuid(i + 1) })), has_more: true },
  ])
    assert.throws(() => readWorkspaceSearch(malformed), /invalid/);
});

test("destinations respect per-record access and the global role for own tenant agreements", () => {
  assert.equal(workspaceSearchHref(item(), "owner"), `/objects/${uuid(1)}`);
  assert.equal(workspaceSearchHref(item({ access: "team" }), "tenant"), `/objects/${uuid(1)}`);
  const tenancy = item({ access: "tenant", agreement_id: uuid(2) });
  assert.equal(workspaceSearchHref(tenancy, "tenant"), `/cabinet?agreementId=${uuid(2)}`);
  assert.equal(workspaceSearchHref(tenancy, "owner"), `/agreements?agreementId=${uuid(2)}`);
  assert.equal(
    workspaceSearchHref(item({ kind: "tenant" }), "admin"),
    `/tenants?tenantId=${uuid(1)}`,
  );
  assert.equal(
    workspaceSearchHref(item({ kind: "agreement", access: "tenant" }), "tenant"),
    `/cabinet?agreementId=${uuid(1)}`,
  );
  assert.equal(
    workspaceSearchHref(item({ kind: "request", access: "team" }), "owner"),
    `/team?property=${uuid(1)}&request=${uuid(1)}`,
  );
  assert.equal(
    workspaceSearchHref(item({ kind: "request", access: "tenant" }), "tenant"),
    `/requests?requestId=${uuid(1)}`,
  );
});

test("response projection ignores arbitrary server URLs and navigation validates IDs again", () => {
  const result = readWorkspaceSearch({
    items: [{ ...item(), href: "https://evil.example/" }],
    has_more: false,
  });
  assert.equal("href" in result.items[0]!, false);
  assert.equal(workspaceSearchHref(result.items[0]!, "owner"), `/objects/${uuid(1)}`);
  assert.throws(
    () => workspaceSearchHref(item({ id: "https://evil.example/" }), "owner"),
    /invalid/,
  );
});
