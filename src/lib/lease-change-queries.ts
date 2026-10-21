import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { enrichAgreementTerms, type LeaseAmendment, type AmendmentEvent } from "./lease-changes";
async function readAmendmentRows<T>(table: "lease_amendments" | "lease_amendment_events") {
  const rows: T[] = [];
  for (let offset = 0; offset < 100_000;) {
    const { data, error, count } = await supabase
      .from(table)
      .select("*", { count: "exact" })
      .order("id")
      .range(offset, offset + 499);
    if (error?.code === "PGRST205") return { available: false, rows: [] as T[] };
    if (error) throw new Error(error.message);
    const loaded = data?.length ?? 0;
    rows.push(...((data ?? []) as unknown as T[]));
    offset += loaded;
    if (!loaded) {
      if (count !== null && offset < count)
        throw new Error("Не удалось прочитать все изменения договора");
      return { available: true, rows };
    }
    if ((count !== null && offset >= count) || (count === null && loaded < 500))
      return { available: true, rows };
  }
  throw new Error("Слишком много изменений договора для загрузки");
}
export async function fetchLeaseChanges() {
  const [amendments, events] = await Promise.all([
    readAmendmentRows<LeaseAmendment>("lease_amendments"),
    readAmendmentRows<AmendmentEvent>("lease_amendment_events"),
  ]);
  return {
    available: amendments.available && events.available,
    amendments: amendments.rows,
    events: events.rows,
  };
}
export async function withAgreementTerms<T extends { id: string; end_date: string }>(
  agreements: T[],
) {
  if (!agreements.length) return agreements;
  const data = await readAmendmentRows<LeaseAmendment>("lease_amendments");
  return enrichAgreementTerms(agreements, data.rows);
}
export async function saveLeaseChange(
  agreementId: string,
  initial: LeaseAmendment | null,
  values: { effective_from: string; monthly_payment: number; end_date: string; note: string },
) {
  const { data, error } = await supabase.rpc("save_lease_amendment", {
    p_agreement_id: agreementId,
    p_values: values as unknown as Json,
    p_id: initial?.id ?? null,
    p_revision: initial?.revision ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}
export async function actOnLeaseChange(amendment: LeaseAmendment, action: string, note: string) {
  const { data, error } = await supabase.rpc("act_on_lease_amendment", {
    p_id: amendment.id,
    p_action: action,
    p_revision: amendment.revision,
    p_note: note.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data;
}
