import { propertyTypeLabels, type PropertyType } from "./domain.ts";
export type CatalogScope = "internal" | "public";
export const catalogSortLabels = {
  newest: "Сначала новые",
  name: "По названию",
  price_asc: "Сначала дешевле",
  price_desc: "Сначала дороже",
  area_desc: "Сначала просторнее",
} as const;
export const occupancyLabels = {
  leased: "Есть действующая аренда",
  reserved: "Подписание / будущая аренда",
  free: "Без действующей аренды",
} as const;
export type CatalogSearch = {
  q: string;
  type: string;
  status: string;
  occupancy: string;
  publication: string;
  price_min: string;
  price_max: string;
  area_min: string;
  area_max: string;
  sort: keyof typeof catalogSortLabels;
  view: "grid" | "list";
};
export const emptyCatalogSearch: CatalogSearch = {
  q: "",
  type: "all",
  status: "all",
  occupancy: "all",
  publication: "all",
  price_min: "",
  price_max: "",
  area_min: "",
  area_max: "",
  sort: "newest",
  view: "grid",
};
function choice(value: unknown, allowed: readonly string[], fallback: string) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function numberFilter(value: unknown) {
  const s = String(value ?? "")
    .trim()
    .replace(",", ".");
  return /^\d{1,9}(\.\d{0,2})?$/.test(s) ? s : "";
}
export function readCatalogSearch(search: Record<string, unknown>): CatalogSearch {
  return {
    q: typeof search["q"] === "string" ? search["q"].slice(0, 200) : "",
    type: choice(search["type"], ["all", ...Object.keys(propertyTypeLabels)], "all"),
    status: choice(search["status"], ["all", "active", "archived"], "all"),
    occupancy: choice(search["occupancy"], ["all", ...Object.keys(occupancyLabels)], "all"),
    publication: choice(search["publication"], ["all", "published", "unpublished"], "all"),
    price_min: numberFilter(search["price_min"]),
    price_max: numberFilter(search["price_max"]),
    area_min: numberFilter(search["area_min"]),
    area_max: numberFilter(search["area_max"]),
    sort: choice(search["sort"], Object.keys(catalogSortLabels), "newest") as CatalogSearch["sort"],
    view: choice(search["view"], ["grid", "list"], "grid") as CatalogSearch["view"],
  };
}
export function catalogFilterError(search: CatalogSearch) {
  for (const [min, max, label] of [
    [search.price_min, search.price_max, "цены"],
    [search.area_min, search.area_max, "площади"],
  ]) {
    if (
      [min, max].some(
        (v) => v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 999999999),
      )
    )
      return "Укажите неотрицательные числа меньше 1 млрд";
    if (min !== "" && max !== "" && Number(min) > Number(max))
      return `Нижняя граница ${label} должна быть не больше верхней`;
  }
  return null;
}
export function catalogFilters(search: CatalogSearch, scope: CatalogScope) {
  const { view, ...filters } = search;
  void view;
  return {
    ...filters,
    q: filters.q.trim(),
    ...(scope === "public" ? { status: "all", occupancy: "all", publication: "all" } : {}),
  };
}
export function hasCatalogFilters(search: CatalogSearch) {
  return Boolean(
    search.q ||
    search.type !== "all" ||
    search.status !== "all" ||
    search.occupancy !== "all" ||
    search.publication !== "all" ||
    search.price_min ||
    search.price_max ||
    search.area_min ||
    search.area_max,
  );
}
export type CatalogItem = {
  id: string;
  scope: CatalogScope;
  title: string;
  location: string;
  description: string | null;
  type: PropertyType;
  status: string;
  occupancy: "leased" | "reserved" | "free" | "offer";
  price: number | null;
  price_source: "offer" | "contract" | null;
  area: number | null;
  photos: string[];
  photo_bucket: "listing-photos" | "property-photos";
  unit_count?: number;
  open_requests?: number;
  role?: "owner" | "manager" | "viewer";
  available_from?: string;
  published: boolean;
  created_at: string;
};
export type CatalogCursor = {
  sort: string;
  rank: number;
  number: string;
  text: string;
  id: string;
};
export type CatalogPage = {
  items: CatalogItem[];
  total: number;
  all_total: number;
  next_cursor: CatalogCursor | null;
};
