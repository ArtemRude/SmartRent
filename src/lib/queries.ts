import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { NotificationHref, NotificationKind } from "@/lib/domain";

export type Property = {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  type: "apartment" | "warehouse" | "commercial" | "other";
  status: string;
  description: string | null;
  photos: string[];
  created_at: string;
};

export type Unit = {
  id: string;
  property_id: string;
  name: string;
  area: number | null;
  status: string;
};

export type Tenant = {
  id: string;
  owner_id: string;
  name: string;
  email: string;
  phone: string | null;
  user_id: string | null;
  created_at: string;
};

export type Agreement = {
  id: string;
  owner_id: string;
  property_id: string;
  unit_id: string | null;
  tenant_id: string;
  start_date: string;
  end_date: string;
  monthly_payment: number;
  status: string;
  document_file: string | null;
  contract_details: Json;
};

export type RequestRow = {
  id: string;
  owner_id: string;
  tenant_id: string;
  property_id: string | null;
  unit_id: string | null;
  title: string;
  description: string;
  category: "repair" | "question" | "payment" | "other";
  status: "new" | "in_progress" | "closed";
  photo: string | null;
  created_at: string;
};

export type CommentRow = {
  id: string;
  request_id: string;
  user_id: string;
  text: string;
  created_at: string;
};

export type RequestStatusEvent = {
  id: string;
  request_id: string;
  from_status: RequestRow["status"] | null;
  to_status: RequestRow["status"];
  changed_by: string | null;
  created_at: string;
};

export type RentCharge = {
  id: string;
  agreement_id: string;
  owner_id: string;
  tenant_id: string;
  period_start: string;
  due_date: string;
  amount: number;
  paid_at: string | null;
  payment_note: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  dedupe_key: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  href: NotificationHref;
  entity_type: "request" | "agreement" | "rent_charge";
  entity_id: string;
  read_at: string | null;
  created_at: string;
};

export type ReminderSettings = {
  owner_id: string;
  enabled: boolean;
  notify_owner: boolean;
  notify_tenant: boolean;
  payment_due_enabled: boolean;
  payment_overdue_enabled: boolean;
  agreement_expiring_enabled: boolean;
  updated_at: string;
};

export function defaultReminderSettings(ownerId: string): ReminderSettings {
  return {
    owner_id: ownerId,
    enabled: true,
    notify_owner: true,
    notify_tenant: true,
    payment_due_enabled: true,
    payment_overdue_enabled: true,
    agreement_expiring_enabled: true,
    updated_at: new Date().toISOString(),
  };
}

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export const fetchProperties = () =>
  unwrap<Property[]>(
    supabase.from("properties").select("*").order("created_at", { ascending: false }),
  );

export const fetchProperty = async (id: string) => {
  const { data, error } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Property | null;
};

export const fetchUnits = () => unwrap<Unit[]>(supabase.from("units").select("*").order("name"));

export const fetchTenants = () =>
  unwrap<Tenant[]>(supabase.from("tenants").select("*").order("created_at", { ascending: false }));

export const fetchAgreements = () =>
  unwrap<Agreement[]>(
    supabase.from("lease_agreements").select("*").order("end_date", { ascending: true }),
  );

export const fetchRequests = () =>
  unwrap<RequestRow[]>(
    supabase.from("requests").select("*").order("created_at", { ascending: false }),
  );

export const fetchComments = (requestId: string) =>
  unwrap<CommentRow[]>(
    supabase
      .from("comments")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true }),
  );

export const fetchRequestStatusEvents = (requestId: string) =>
  unwrap<RequestStatusEvent[]>(
    supabase
      .from("request_status_events")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true }),
  );

export const fetchRentCharges = () =>
  unwrap<RentCharge[]>(
    supabase.from("rent_charges").select("*").order("due_date", { ascending: false }),
  );

export const fetchNotifications = async () =>
  (await unwrap(
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
  )) as NotificationRow[];

export const fetchReminderSettings = async (ownerId: string) => {
  const { data, error } = await supabase
    .from("reminder_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReminderSettings | null) ?? defaultReminderSettings(ownerId);
};

export const saveReminderSettings = async (settings: ReminderSettings) => {
  const next = { ...settings, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("reminder_settings")
    .upsert(next, { onConflict: "owner_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as ReminderSettings;
};

export const markNotificationRead = async (id: string) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
};

export const markAllNotificationsRead = async () => {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) throw new Error(error.message);
};

export const fetchMyTenantRecords = async (userId: string) =>
  unwrap<Tenant[]>(supabase.from("tenants").select("*").eq("user_id", userId));
