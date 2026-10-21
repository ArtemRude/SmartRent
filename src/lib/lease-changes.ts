import type { Json } from "../integrations/supabase/types";
export type RentTerm = { effective_from: string; monthly_payment: number };
export type LeaseAmendment = {
  id: string;
  agreement_id: string;
  status: "draft" | "pending" | "accepted" | "rejected" | "cancelled";
  revision: number;
  effective_from: string;
  monthly_payment: number;
  end_date: string;
  previous_monthly_payment: number;
  previous_end_date: string;
  note: string;
  review_note: string | null;
  agreement_snapshot: Json;
  submitted_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};
export type AmendmentEvent = {
  id: string;
  amendment_id: string;
  actor_id: string | null;
  event_type: "draft_saved" | "submitted" | "accepted" | "rejected" | "cancelled";
  snapshot: Json;
  created_at: string;
};
export const amendmentLabels = {
  draft: "Черновик",
  pending: "На согласовании",
  accepted: "Согласовано",
  rejected: "Отклонено",
  cancelled: "Отменено",
};
export function nextRentMonth(today: string) {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  return month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
}
export function rentAt(
  agreement: { monthly_payment: number; rent_schedule?: RentTerm[] },
  period: string,
) {
  const applicable = (agreement.rent_schedule ?? [])
    .filter((term) => term.effective_from.slice(0, 7) <= period.slice(0, 7))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return Number(applicable[0]?.monthly_payment ?? agreement.monthly_payment);
}
export function enrichAgreementTerms<T extends { id: string; end_date: string }>(
  agreements: T[],
  amendments: LeaseAmendment[],
) {
  return agreements.map((agreement) => {
    const rows = amendments.filter((m) => m.agreement_id === agreement.id);
    const accepted = rows
      .filter((m) => m.status === "accepted")
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    return {
      ...agreement,
      rent_schedule: accepted.map((m) => ({
        effective_from: m.effective_from,
        monthly_payment: Number(m.monthly_payment),
      })),
      original_end_date: accepted[0]?.previous_end_date ?? agreement.end_date,
      terms_locked: rows.some((m) => m.status === "pending" || m.status === "accepted"),
    };
  });
}
export const amendmentMoney = (amount: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
  }).format(amount);
