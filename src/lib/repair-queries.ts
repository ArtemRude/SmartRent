import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { RepairContractor, RepairJob, RepairsOverview } from "./repairs";
export async function fetchRepairs(signal?: AbortSignal) {
  let query = supabase.rpc("repairs_overview");
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error?.code === "PGRST202") return { available: false, overview: null };
  if (error) throw new Error(error.message);
  const overview = data as unknown as RepairsOverview;
  if (
    !overview ||
    ![
      overview.properties,
      overview.contractors,
      overview.requests,
      overview.jobs,
      overview.events,
    ].every(Array.isArray)
  )
    throw new Error("Не удалось получить все сведения о ремонтах");
  return { available: true, overview };
}
export async function saveRepairContractor(
  ownerId: string,
  initial: RepairContractor | null,
  values: Record<string, Json>,
) {
  const { data, error } = await supabase.rpc("save_repair_contractor", {
    p_owner_id: ownerId,
    p_id: initial?.id ?? null,
    p_values: values,
    p_revision: initial?.revision ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}
export async function saveRepairJob(
  propertyId: string,
  initial: RepairJob | null,
  values: Record<string, Json>,
) {
  const { data, error } = await supabase.rpc("save_repair_job", {
    p_property_id: propertyId,
    p_id: initial?.id ?? null,
    p_values: values,
    p_revision: initial?.revision ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}
export async function actOnRepair(
  job: RepairJob,
  action: string,
  values: Record<string, Json> = {},
) {
  const { data, error } = await supabase.rpc("act_on_repair_job", {
    p_id: job.id,
    p_action: action,
    p_revision: job.revision,
    p_values: values,
  });
  if (error) throw new Error(error.message);
  return data;
}
