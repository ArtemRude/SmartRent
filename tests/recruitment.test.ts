import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listingUrl,
  validListingId,
  openApplication,
  type RentalApplication,
} from "../src/lib/recruitment.ts";
test("listing return accepts only a UUID and never an arbitrary redirect", () => {
  const id = "f9000000-0000-0000-0000-000000000001";
  assert.equal(listingUrl(id), `/listing/${id}`);
  for (const value of [
    "https://evil.invalid",
    "//evil.invalid",
    "../admin",
    "x?next=/admin",
    "",
    null,
    undefined,
  ])
    assert.equal(validListingId(value), false);
  assert.throws(() => listingUrl("//evil.invalid"));
});
test("completed candidate outcomes are excluded from the active pipeline", () => {
  for (const status of ["new", "showing", "shortlisted"] as const)
    assert.equal(openApplication({ status } as RentalApplication), true);
  for (const status of ["accepted", "rejected", "withdrawn"] as const)
    assert.equal(openApplication({ status } as RentalApplication), false);
});
