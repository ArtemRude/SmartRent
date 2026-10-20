import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { HandoverKind } from "@/lib/handovers";

export async function fetchHandovers() {
  const [reports, events] = await Promise.all([
    supabase.from("lease_handovers").select("*").order("created_at", { ascending: false }),
    supabase.from("lease_handover_events").select("*").order("created_at", { ascending: false }),
  ]);
  if ([reports, events].some((result) => result.error?.code === "PGRST205")) {
    return { available: false, reports: [], events: [] };
  }
  if (reports.error) throw new Error(reports.error.message);
  if (events.error) throw new Error(events.error.message);
  return { available: true, reports: reports.data ?? [], events: events.data ?? [] };
}

export async function saveHandover(
  agreementId: string,
  kind: HandoverKind,
  report: Json,
  revision: number | null,
) {
  const { data, error } = await supabase.rpc("save_lease_handover", {
    p_agreement_id: agreementId,
    p_kind: kind,
    p_report: report,
    p_expected_revision: revision,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function actOnHandover(
  id: string,
  action: string,
  revision: number,
  note: string | null = null,
) {
  const { error } = await supabase.rpc("act_on_lease_handover", {
    p_handover_id: id,
    p_action: action,
    p_expected_revision: revision,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}
