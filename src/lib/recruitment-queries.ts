import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { PropertyHub, PublicListing, RecruitmentOverview } from "./recruitment";
export class RecruitmentError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
function fail(error: { message: string; code: string }) {
  throw new RecruitmentError(error.message, error.code);
}
export async function fetchPublicListing(id: string, signal?: AbortSignal) {
  let q = supabase.rpc("public_listing", { p_public_id: id });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) fail(error);
  if (data && !(data as unknown as PublicListing).details)
    throw new Error("Не удалось прочитать объявление");
  return data as unknown as PublicListing | null;
}
export async function fetchPropertyHub(id: string, signal?: AbortSignal) {
  let q = supabase.rpc("property_hub", { p_property_id: id });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) fail(error);
  const hub = data as unknown as PropertyHub;
  if (
    !hub?.property ||
    ![hub.units, hub.repairs, hub.listings, hub.applications, hub.events].every(Array.isArray)
  )
    throw new Error("Получены неполные сведения объекта");
  return hub;
}
export async function fetchRecruitment(signal?: AbortSignal) {
  let q = supabase.rpc("recruitment_overview");
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) fail(error);
  const result = data as unknown as RecruitmentOverview;
  if (!result || ![result.properties, result.applications].every(Array.isArray))
    throw new Error("Не удалось прочитать заявки на аренду");
  return result;
}
export async function saveListing(
  propertyId: string,
  id: string | null,
  unitId: string | null,
  values: Json,
  revision: number | null,
) {
  const { data, error } = await supabase.rpc("save_property_listing", {
    p_property_id: propertyId,
    p_id: id,
    p_unit_id: unitId,
    p_values: values,
    p_revision: revision,
  });
  if (error) fail(error);
  return data!;
}
export async function actOnListing(id: string, action: string, revision: number) {
  const { error } = await supabase.rpc("act_on_property_listing", {
    p_id: id,
    p_action: action,
    p_revision: revision,
  });
  if (error) fail(error);
}
export async function applyToListing(id: string, values: Json) {
  const { data, error } = await supabase.rpc("apply_to_listing", {
    p_public_id: id,
    p_values: values,
  });
  if (error) fail(error);
  return data!;
}
export async function actOnApplication(
  id: string,
  action: string,
  revision: number,
  values: Json = {},
) {
  const { data, error } = await supabase.rpc("act_on_rental_application", {
    p_id: id,
    p_action: action,
    p_revision: revision,
    p_values: values,
  });
  if (error) fail(error);
  return data!;
}
