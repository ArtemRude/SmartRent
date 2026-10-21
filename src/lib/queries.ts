import { withAgreementTerms } from "./lease-change-queries";
import type { RentTerm } from "./lease-changes";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { AgreementStatus, NotificationHref, NotificationKind } from "@/lib/domain";

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
  rent_schedule?: RentTerm[];
  original_end_date?: string;
  terms_locked?: boolean;
  id: string;
  created_at: string;
  owner_id: string;
  property_id: string;
  unit_id: string | null;
  tenant_id: string;
  start_date: string;
  end_date: string;
  monthly_payment: number;
  payment_due_day: number | null;
  status: AgreementStatus;
  document_file: string | null;
  signed_document_file: string | null;
  signed_at: string | null;
  status_changed_at: string;
  contract_details: Json;
};

export type AgreementStatusEvent = {
  id: string;
  agreement_id: string;
  from_status: AgreementStatus | null;
  to_status: AgreementStatus;
  changed_by: string | null;
  created_at: string;
};

export type AgreementAcceptance = {
  id: string;
  agreement_id: string;
  agreement_version: string;
  accepted_by: string | null;
  accepted_at: string;
  photos: string[];
};

export type PropertyActivityEvent = {
  id: string;
  property_id: string;
  actor_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  details: Json;
  created_at: string;
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
  adjustment_amount: number;
  adjustment_reason: string | null;
  adjusted_at: string | null;
  adjusted_by: string | null;
  paid_at: string | null;
  paid_amount: number;
  payment_note: string | null;
  created_at: string;
  charge_type?: "rent" | "utilities";
};

export type RentPayment = {
  id: string;
  charge_id: string;
  owner_id: string;
  tenant_id: string;
  amount: number;
  paid_at: string;
  payment_method: "bank_transfer" | "cash" | null;
  note: string | null;
  receipt_file: string | null;
  created_by: string | null;
  created_at: string;
};

export type RentPaymentState = {
  payments: RentPayment[];
  available: boolean;
  receiptsAvailable: boolean;
  paymentMethodsAvailable: boolean;
};

export type PaymentReport = {
  id: string;
  charge_id: string;
  owner_id: string;
  tenant_id: string;
  reported_by: string;
  amount: number;
  paid_at: string;
  payment_method: "bank_transfer" | "cash";
  receipt_file: string | null;
  note: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewed_by: string | null;
  reviewed_at: string | null;
  cancelled_at: string | null;
  review_note: string | null;
  payment_id: string | null;
  created_at: string;
};

export type PaymentReportState = {
  reports: PaymentReport[];
  available: boolean;
};

export type RentChargeAdjustmentEvent = {
  id: string;
  charge_id: string;
  previous_adjustment_amount: number;
  adjustment_amount: number;
  reason: string;
  changed_by: string | null;
  created_at: string;
};

export type RentChargeAdjustmentState = {
  events: RentChargeAdjustmentEvent[];
  available: boolean;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  dedupe_key: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  href: NotificationHref;
  entity_type: "request" | "agreement" | "rent_charge" | "repair";
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

export const fetchUnitsForProperty = (propertyId: string) =>
  unwrap<Unit[]>(supabase.from("units").select("*").eq("property_id", propertyId).order("name"));

export const fetchTenants = () =>
  unwrap<Tenant[]>(supabase.from("tenants").select("*").order("created_at", { ascending: false }));

export const fetchAgreements = async () =>
  withAgreementTerms(
    await unwrap<Agreement[]>(
      supabase.from("lease_agreements").select("*").order("end_date", { ascending: true }),
    ),
  );

export const fetchAgreementsForProperty = async (propertyId: string) =>
  withAgreementTerms(
    await unwrap<Agreement[]>(
      supabase
        .from("lease_agreements")
        .select("*")
        .eq("property_id", propertyId)
        .order("end_date", { ascending: true }),
    ),
  );

export const fetchAgreementStatusEvents = () =>
  unwrap<AgreementStatusEvent[]>(
    supabase.from("agreement_status_events").select("*").order("created_at", { ascending: true }),
  );

export const fetchAgreementAcceptances = () =>
  unwrap<AgreementAcceptance[]>(
    supabase.from("agreement_acceptances").select("*").order("accepted_at", { ascending: false }),
  );

export const fetchRequests = () =>
  unwrap<RequestRow[]>(
    supabase.from("requests").select("*").order("created_at", { ascending: false }),
  );

export const fetchRequestsForProperty = (propertyId: string) =>
  unwrap<RequestRow[]>(
    supabase
      .from("requests")
      .select("*")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false }),
  );

export type PropertyTimelineSources = {
  propertyEvents: PropertyActivityEvent[];
  agreementEvents: AgreementStatusEvent[];
  agreementAcceptances: AgreementAcceptance[];
  requestEvents: RequestStatusEvent[];
  charges: RentCharge[];
  payments: RentPayment[];
};

export const fetchPropertyTimelineSources = async (
  propertyId: string,
  agreementIds: string[],
  requestIds: string[],
): Promise<PropertyTimelineSources> => {
  const propertyEventsRequest = supabase
    .from("property_activity_events")
    .select("*")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(200);
  const agreementEventsRequest = agreementIds.length
    ? unwrap<AgreementStatusEvent[]>(
        supabase
          .from("agreement_status_events")
          .select("*")
          .in("agreement_id", agreementIds)
          .order("created_at", { ascending: false })
          .limit(300),
      )
    : Promise.resolve([]);
  const agreementAcceptancesRequest = agreementIds.length
    ? unwrap<AgreementAcceptance[]>(
        supabase
          .from("agreement_acceptances")
          .select("*")
          .in("agreement_id", agreementIds)
          .order("accepted_at", { ascending: false })
          .limit(200),
      )
    : Promise.resolve([]);
  const requestEventsRequest = requestIds.length
    ? unwrap<RequestStatusEvent[]>(
        supabase
          .from("request_status_events")
          .select("*")
          .in("request_id", requestIds)
          .order("created_at", { ascending: false })
          .limit(300),
      )
    : Promise.resolve([]);
  const chargesRequest = agreementIds.length
    ? unwrap<RentCharge[]>(
        supabase
          .from("rent_charges")
          .select("*")
          .in("agreement_id", agreementIds)
          .order("due_date", { ascending: false })
          .limit(500),
      )
    : Promise.resolve([]);

  const [propertyEventsResult, agreementEvents, agreementAcceptances, requestEvents, charges] =
    await Promise.all([
      propertyEventsRequest,
      agreementEventsRequest,
      agreementAcceptancesRequest,
      requestEventsRequest,
      chargesRequest,
    ]);

  const activityUnavailable =
    propertyEventsResult.error?.code === "PGRST205" || propertyEventsResult.error?.code === "42501";
  if (propertyEventsResult.error && !activityUnavailable) {
    throw new Error(propertyEventsResult.error.message);
  }
  const propertyEvents = activityUnavailable
    ? []
    : ((propertyEventsResult.data ?? []) as PropertyActivityEvent[]);

  const chargeIds = charges.map((charge) => charge.id);
  const payments = chargeIds.length
    ? await unwrap<RentPayment[]>(
        supabase
          .from("rent_payments")
          .select("*")
          .in("charge_id", chargeIds)
          .order("paid_at", { ascending: false })
          .limit(500),
      )
    : [];

  return {
    propertyEvents,
    agreementEvents,
    agreementAcceptances,
    requestEvents,
    charges,
    payments,
  };
};

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

export const fetchRentPayments = async (): Promise<RentPaymentState> => {
  const { data, error } = await supabase
    .from("rent_payments")
    .select("*, receipt_file, payment_method")
    .order("paid_at", { ascending: false });
  if (error?.code === "PGRST205") {
    return {
      payments: [],
      available: false,
      receiptsAvailable: false,
      paymentMethodsAvailable: false,
    };
  }
  if (error) {
    const receiptFallback = await supabase
      .from("rent_payments")
      .select("*, receipt_file")
      .order("paid_at", { ascending: false });
    if (!receiptFallback.error) {
      return {
        payments: (receiptFallback.data ?? []).map((payment) => ({
          ...(payment as Omit<RentPayment, "payment_method">),
          payment_method: null,
        })),
        available: true,
        receiptsAvailable: true,
        paymentMethodsAvailable: false,
      };
    }
    const legacyFallback = await supabase
      .from("rent_payments")
      .select("*")
      .order("paid_at", { ascending: false });
    if (legacyFallback.error) throw new Error(error.message);
    return {
      payments: (legacyFallback.data ?? []).map((payment) => ({
        ...(payment as Omit<RentPayment, "receipt_file" | "payment_method">),
        receipt_file: null,
        payment_method: null,
      })),
      available: true,
      receiptsAvailable: false,
      paymentMethodsAvailable: false,
    };
  }
  return {
    payments: (data ?? []) as RentPayment[],
    available: true,
    receiptsAvailable: true,
    paymentMethodsAvailable: true,
  };
};

export const fetchRentChargeAdjustmentEvents = async (): Promise<RentChargeAdjustmentState> => {
  const { data, error } = await supabase
    .from("rent_charge_adjustment_events")
    .select("*")
    .order("created_at", { ascending: false });

  // Deploying the web app and its database migration is not atomic. Keep the
  // existing payments page available while Supabase catches up with the commit.
  if (error?.code === "PGRST205") return { events: [], available: false };
  if (error) throw new Error(error.message);
  return { events: (data ?? []) as RentChargeAdjustmentEvent[], available: true };
};

export const fetchPaymentReports = async (): Promise<PaymentReportState> => {
  const { data, error } = await supabase
    .from("payment_reports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error?.code === "PGRST205" || error?.code === "42501") {
    return { reports: [], available: false };
  }
  if (error) throw new Error(error.message);
  return { reports: (data ?? []) as PaymentReport[], available: true };
};

export const reviewPaymentReport = async ({
  reportId,
  approve,
  reviewNote,
}: {
  reportId: string;
  approve: boolean;
  reviewNote?: string;
}) => {
  const { data, error } = await supabase.rpc("review_payment_report", {
    p_report_id: reportId,
    p_approve: approve,
    ...(reviewNote !== undefined ? { p_review_note: reviewNote } : {}),
  });
  if (error?.code === "PGRST202") {
    throw new Error("Подтверждение оплат временно недоступно");
  }
  if (error) throw new Error(error.message);
  return data as "approved" | "rejected";
};

export const cancelPaymentReport = async (reportId: string) => {
  const { data, error } = await supabase.rpc("cancel_payment_report", {
    p_report_id: reportId,
  });
  if (error?.code === "PGRST202") {
    throw new Error("Отмена сообщения временно недоступна");
  }
  if (error) throw new Error(error.message);
  return data as "cancelled";
};

export const fetchNotifications = async () =>
  (await unwrap(
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
  )) as NotificationRow[];

export type PaymentReminderResult = "sent" | "already_sent" | "tenant_not_connected" | "no_debt";

export const sendPaymentReminder = async (agreementId: string) => {
  const { data, error } = await supabase.rpc("send_payment_reminder", {
    p_agreement_id: agreementId,
  });
  if (error?.code === "PGRST202") {
    throw new Error("Напоминания временно недоступны");
  }
  if (error) throw new Error(error.message);
  return data as PaymentReminderResult;
};

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
