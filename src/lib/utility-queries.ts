import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { UtilityBill, UtilityBillItem, UtilityService } from "@/lib/utilities";

export async function fetchUtilityData() {
  const results = await Promise.all([
    supabase.from("utility_services").select("*").order("created_at"),
    supabase
      .from("utility_bills")
      .select("*")
      .order("period_start", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("utility_bill_items").select("*").order("name"),
  ]);
  if (results.some((result) => result.error?.code === "PGRST205")) {
    return { available: false, services: [], bills: [], items: [] };
  }
  for (const result of results) if (result.error) throw new Error(result.error.message);
  return {
    available: true,
    services: (results[0].data ?? []) as UtilityService[],
    bills: (results[1].data ?? []) as UtilityBill[],
    items: (results[2].data ?? []) as UtilityBillItem[],
  };
}

export async function saveUtilityService(agreementId: string, service: Json) {
  const { data, error } = await supabase.rpc("save_utility_service", {
    p_agreement_id: agreementId,
    p_service: service,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function submitUtilityReadings(agreementId: string, period: string, readings: Json) {
  const { data, error } = await supabase.rpc("submit_utility_readings", {
    p_agreement_id: agreementId,
    p_period: `${period}-01`,
    p_readings: readings,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function reviewUtilityBill(
  billId: string,
  approve: boolean,
  note: string,
  dueDate: string,
) {
  const { data, error } = await supabase.rpc("review_utility_bill", {
    p_bill_id: billId,
    p_approve: approve,
    p_note: note.trim() || null,
    p_due_date: dueDate,
  });
  if (error) throw new Error(error.message);
  return data;
}
