import { supabase } from "@/integrations/supabase/client";
import { readRentalCalendar } from "./rental-calendar";

export async function fetchRentalCalendar(
  from: string,
  to: string,
  timezone: string,
  propertyId: string | null,
  responsibleId: string | null,
  signal?: AbortSignal,
) {
  let query = supabase.rpc("rental_calendar", {
    p_from: from,
    p_to: to,
    p_timezone: timezone,
    p_property_id: propertyId,
    p_responsible_id: responsibleId,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error?.code === "PGRST202") return { available: false, overview: null };
  if (error) throw new Error(error.message);
  const overview = readRentalCalendar(data);
  if (overview.from !== from || overview.to !== to || overview.timezone !== timezone)
    throw new Error("Получен календарь другого периода. Обновите раздел.");
  return { available: true, overview };
}
