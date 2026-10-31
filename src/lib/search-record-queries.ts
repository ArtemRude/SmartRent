import { supabase } from "@/integrations/supabase/client";
import { withAgreementTerms } from "./lease-change-queries";
import type { Agreement, Property, RequestRow, Tenant, Unit } from "./queries";
import type { TeamWorkspace } from "./team";

export function isSearchRecordId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

async function readExact<T>(
  table: "lease_agreements" | "tenants" | "requests" | "properties" | "units",
  id: string,
  signal?: AbortSignal,
): Promise<T | null> {
  if (!isSearchRecordId(id)) return null;
  let query = supabase.from(table).select("*").eq("id", id);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (data && data.id !== id) throw new Error("Получена другая запись. Повторите поиск.");
  return data as T | null;
}

async function context(
  record: { property_id: string | null; tenant_id: string; unit_id: string | null },
  signal?: AbortSignal,
) {
  const [property, tenant, unit] = await Promise.all([
    record.property_id ? readExact<Property>("properties", record.property_id, signal) : null,
    readExact<Tenant>("tenants", record.tenant_id, signal),
    record.unit_id ? readExact<Unit>("units", record.unit_id, signal) : null,
  ]);
  return { property, tenant, unit };
}

export async function fetchSearchAgreement(id: string, signal?: AbortSignal) {
  const raw = await readExact<Agreement>("lease_agreements", id, signal);
  if (!raw) return null;
  const [agreement] = await withAgreementTerms([raw]);
  return { agreement: agreement!, ...(await context(raw, signal)) };
}

export const fetchSearchTenant = (id: string, signal?: AbortSignal) =>
  readExact<Tenant>("tenants", id, signal);

export async function fetchSearchRequest(id: string, signal?: AbortSignal) {
  const request = await readExact<RequestRow>("requests", id, signal);
  return request ? { request, ...(await context(request, signal)) } : null;
}

// The selected record is authoritative: never fall back to an old list row after
// the exact lookup returns null or fails (for example after permission revocation).
export function mergeSelectedRecord<T extends { id: string }>(
  list: T[] | undefined,
  selectedId: string | undefined,
  selected: T | null | undefined,
): T[] {
  if (!selectedId) return list ?? [];
  const remaining = (list ?? []).filter((row) => row.id !== selectedId);
  return selected?.id === selectedId ? [selected, ...remaining] : remaining;
}

export async function fetchSearchTeamRequest(id: string, propertyId: string, signal?: AbortSignal) {
  if (!isSearchRecordId(id) || !isSearchRecordId(propertyId)) return null;
  let query = supabase.rpc("workspace_search_team_request", { p_id: id });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (data == null) return null;
  const result = data as unknown as {
    property_id: string;
    request: TeamWorkspace["requests"][number];
  };
  if (
    result.property_id !== propertyId ||
    result.request?.id !== id ||
    typeof result.request.title !== "string" ||
    typeof result.request.description !== "string" ||
    typeof result.request.created_at !== "string" ||
    typeof result.request.tenant_name !== "string" ||
    !["new", "in_progress", "closed"].includes(result.request.status) ||
    !["repair", "question", "payment", "other"].includes(result.request.category)
  )
    throw new Error("Выбранная заявка недоступна на этом объекте.");
  return result.request;
}

export function scrollToSearchRecord(id: string) {
  document.getElementById(id)?.scrollIntoView({
    block: "center",
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}
