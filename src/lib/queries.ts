import { supabase } from "@/integrations/supabase/client";

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

export const fetchMyTenantRecords = async (userId: string) =>
  unwrap<Tenant[]>(supabase.from("tenants").select("*").eq("user_id", userId));
