import type { Json } from "@/integrations/supabase/types";
export type HandoverKind = "move_in" | "move_out";
export type HandoverStatus = "draft" | "pending" | "confirmed" | "disputed";
export const handoverChecks = {
  condition: "Состояние помещения осмотрено",
  inventory: "Имущество сверено с описью",
  meters: "Показания счётчиков зафиксированы",
  keys: "Ключи пересчитаны",
} as const;
export type HandoverCheck = keyof typeof handoverChecks;
export type HandoverDeduction = { reason: string; amount: number };
export type LeaseHandover = {
  id: string;
  agreement_id: string;
  kind: HandoverKind;
  status: HandoverStatus;
  revision: number;
  inspection_date: string;
  keys_count: number;
  inventory_snapshot: Json;
  checklist: Record<HandoverCheck, boolean>;
  condition_note: string;
  meter_readings: string;
  photos: string[];
  deductions: HandoverDeduction[];
  deposit_received: number;
  deductions_total: number;
  refund_due: number;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  refund_marked_at: string | null;
  refund_confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
export type HandoverEvent = {
  id: string;
  handover_id: string;
  actor_id: string | null;
  event_type: string;
  note: string | null;
  snapshot: LeaseHandover;
  created_at: string;
};
export const handoverStatusLabels: Record<HandoverStatus, string> = {
  draft: "Черновик",
  pending: "Ожидает арендатора",
  confirmed: "Акт подтверждён",
  disputed: "Есть замечания",
};

export function parseHandoverMoney(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return amount < 1_000_000_000 ? amount : null;
}

export function calculateDeposit(received: number, deductions: readonly HandoverDeduction[]) {
  const toKopecks = (value: number) => {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value >= 1_000_000_000 ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.00001
    ) {
      throw new Error("Укажите сумму в рублях с точностью до копеек");
    }
    return Math.round(value * 100);
  };
  const deposit = toKopecks(received);
  const retained = deductions.reduce((sum, item) => {
    if (!item.reason.trim()) throw new Error("Для каждого удержания укажите причину");
    return sum + toKopecks(item.amount);
  }, 0);
  if (retained > deposit) throw new Error("Удержания не могут превышать полученный депозит");
  return { deposit: deposit / 100, retained: retained / 100, refund: (deposit - retained) / 100 };
}
