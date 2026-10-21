import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readCatalogSearch,
  emptyCatalogSearch,
  catalogFilterError,
  catalogFilters,
  hasCatalogFilters,
} from "../src/lib/property-catalog.ts";
test("catalog normalizes URL filters and rejects unknown options", () => {
  assert.deepEqual(readCatalogSearch({}), emptyCatalogSearch);
  const s = readCatalogSearch({
    q: "я".repeat(250),
    type: "unknown",
    sort: "price;drop",
    price_min: "12,50",
    area_max: "-1",
    view: "list",
  });
  assert.equal(s.q.length, 200);
  assert.equal(s.type, "all");
  assert.equal(s.sort, "newest");
  assert.equal(s.price_min, "12.50");
  assert.equal(s.area_max, "");
  assert.equal(s.view, "list");
});
test("inverted numeric ranges cannot become a different implicit query", () => {
  assert.match(
    catalogFilterError({ ...emptyCatalogSearch, price_min: "60000", price_max: "50000" })!,
    /цены/,
  );
  assert.match(
    catalogFilterError({ ...emptyCatalogSearch, area_min: "100", area_max: "20" })!,
    /площади/,
  );
  assert.equal(catalogFilterError({ ...emptyCatalogSearch, price_min: "0", price_max: "0" }), null);
  assert.ok(catalogFilterError({ ...emptyCatalogSearch, area_max: "NaN" }));
});
test("display preference never changes the dataset, public queries discard internal state", () => {
  assert.deepEqual(
    catalogFilters(emptyCatalogSearch, "internal"),
    catalogFilters({ ...emptyCatalogSearch, view: "list" }, "internal"),
  );
  const filters = catalogFilters(
    {
      ...emptyCatalogSearch,
      q: " Москва ",
      status: "archived",
      occupancy: "leased",
      publication: "unpublished",
    },
    "public",
  );
  assert.equal(filters.q, "Москва");
  assert.equal(filters.status, "all");
  assert.equal(filters.occupancy, "all");
  assert.equal(filters.publication, "all");
  assert.equal("view" in filters, false);
});
test("active filters and display/sort preferences are distinct", () => {
  assert.equal(
    hasCatalogFilters({ ...emptyCatalogSearch, view: "list", sort: "price_asc" }),
    false,
  );
  assert.equal(hasCatalogFilters({ ...emptyCatalogSearch, price_max: "0" }), true);
  assert.equal(hasCatalogFilters({ ...emptyCatalogSearch, status: "archived" }), true);
});
