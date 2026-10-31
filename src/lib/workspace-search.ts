export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_DEBOUNCE_MS = 250;
export const searchKinds = ["property", "tenant", "agreement", "request"] as const;
export type SearchKind = (typeof searchKinds)[number];
export type WorkspaceSearchItem = {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  status: string | null;
  property_id: string | null;
  agreement_id: string | null;
  access: "owner" | "team" | "tenant";
};
export type WorkspaceSearchResult = { items: WorkspaceSearchItem[]; has_more: boolean };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nullableUuid = (value: unknown) =>
  value === null || (typeof value === "string" && uuid.test(value));

export function normalizeWorkspaceSearch(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/** Reject incomplete responses rather than showing a falsely empty/partial search. */
export function readWorkspaceSearch(value: unknown): WorkspaceSearchResult {
  if (
    !record(value) ||
    !Array.isArray(value["items"]) ||
    typeof value["has_more"] !== "boolean" ||
    value["items"].length > 40
  )
    throw new Error("workspace_search_invalid");
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const items = value["items"].map((item: unknown): WorkspaceSearchItem => {
    if (
      !record(item) ||
      !searchKinds.includes(item["kind"] as SearchKind) ||
      typeof item["id"] !== "string" ||
      !uuid.test(item["id"]) ||
      typeof item["title"] !== "string" ||
      !item["title"].trim() ||
      item["title"].length > 500 ||
      typeof item["subtitle"] !== "string" ||
      item["subtitle"].length > 1500 ||
      !(
        item["status"] === null ||
        (typeof item["status"] === "string" && item["status"].length <= 100)
      ) ||
      !nullableUuid(item["property_id"]) ||
      !nullableUuid(item["agreement_id"]) ||
      !["owner", "team", "tenant"].includes(item["access"] as string) ||
      (item["kind"] === "tenant" && item["access"] !== "owner") ||
      (item["kind"] === "agreement" && item["access"] === "team") ||
      (item["kind"] === "property" &&
        item["access"] === "tenant" &&
        item["agreement_id"] === null) ||
      (item["kind"] === "request" && item["access"] === "team" && item["property_id"] === null)
    )
      throw new Error("workspace_search_invalid");
    const key = `${item["kind"]}:${item["id"]}`;
    const count = (counts.get(item["kind"] as string) ?? 0) + 1;
    if (seen.has(key) || count > 10) throw new Error("workspace_search_invalid");
    seen.add(key);
    counts.set(item["kind"] as string, count);
    return {
      kind: item["kind"] as SearchKind,
      id: item["id"],
      title: item["title"],
      subtitle: item["subtitle"],
      status: item["status"] as string | null,
      property_id: item["property_id"] as string | null,
      agreement_id: item["agreement_id"] as string | null,
      access: item["access"] as WorkspaceSearchItem["access"],
    };
  });
  return { items, has_more: value["has_more"] };
}

export function workspaceSearchHref(
  item: WorkspaceSearchItem,
  role: "owner" | "tenant" | "admin",
): string {
  // Even a malformed caller cannot introduce an arbitrary destination URL.
  const validated = readWorkspaceSearch({ items: [item], has_more: false }).items[0]!;
  if (validated.kind === "property") {
    if (validated.access !== "tenant") return `/objects/${validated.id}`;
    return `/${role === "tenant" ? "cabinet" : "agreements"}?agreementId=${validated.agreement_id}`;
  }
  if (validated.kind === "tenant") return `/tenants?tenantId=${validated.id}`;
  if (validated.kind === "agreement")
    return `/${role === "tenant" ? "cabinet" : "agreements"}?agreementId=${validated.id}`;
  if (validated.access === "team")
    return `/team?property=${validated.property_id}&request=${validated.id}`;
  return `/requests?requestId=${validated.id}`;
}

export async function fetchWorkspaceSearch(
  query: string,
  signal?: AbortSignal,
): Promise<WorkspaceSearchResult> {
  const normalized = normalizeWorkspaceSearch(query);
  if (normalized.length < SEARCH_MIN_LENGTH || normalized.length > SEARCH_MAX_LENGTH)
    throw new Error("workspace_search_query_invalid");
  const { supabase } = await import("@/integrations/supabase/client");
  const request = supabase.rpc("workspace_search", { p_query: normalized });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw new Error("workspace_search_unavailable");
  return readWorkspaceSearch(data);
}
