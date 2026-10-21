import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CatalogPage, CatalogCursor, CatalogScope, CatalogSearch } from "./property-catalog";
import { catalogFilters } from "./property-catalog";
export class CatalogApiError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
export async function fetchPropertyCatalog(
  scope: CatalogScope,
  search: CatalogSearch,
  cursor: CatalogCursor | null,
  signal?: AbortSignal,
) {
  let q = supabase.rpc(scope === "public" ? "public_property_catalog" : "property_catalog", {
    p_filters: catalogFilters(search, scope),
    p_cursor: cursor as unknown as Json,
  });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw new CatalogApiError(error.message, error.code);
  const page = data as unknown as CatalogPage;
  if (
    !page ||
    !Array.isArray(page.items) ||
    !Number.isFinite(page.total) ||
    !Number.isFinite(page.all_total)
  )
    throw new Error("Получен неполный каталог. Обновите страницу.");
  return page;
}
export async function setCatalogPropertyStatus(id: string, expected: string, status: string) {
  const { error } = await supabase.rpc("set_catalog_property_status", {
    p_id: id,
    p_expected: expected,
    p_status: status,
  });
  if (error) throw new CatalogApiError(error.message, error.code);
}
