export type BillingPlanId = "start" | "owner" | "portfolio" | "team";
export type BillingMode = "prelaunch" | "enforced";
export type BillingPhase =
  "unavailable" | "prelaunch" | "notice" | "trial" | "active" | "grace" | "restricted" | "free";

export type BillingOverview = {
  available: boolean;
  mode: BillingMode;
  launched_at: string | null;
  notice_until: string | null;
  plan: BillingPlanId;
  paid_until: string | null;
  trial_until: string | null;
  units_used: number;
  seats_used: number;
};

export const BILLING_GRACE_DAYS = 7;
export const BILLING_NOTICE_DAYS = 30;
const DAY = 86_400_000;

export const BILLING_PLANS: {
  id: BillingPlanId;
  name: string;
  price: number;
  units: number;
  seats: number;
  description: string;
  features: string[];
}[] = [
  {
    id: "start",
    name: "Старт",
    price: 0,
    units: 1,
    seats: 0,
    description: "Для первой аренды",
    features: [
      "Договоры и кабинет арендатора",
      "Начисления, учёт оплат и коммунальные расчёты",
      "Заявки, заселение, выезд и продление",
    ],
  },
  {
    id: "owner",
    name: "Собственник",
    price: 590,
    units: 5,
    seats: 0,
    description: "Для небольшого портфеля",
    features: ["Всё из «Старта»", "Расходы и чеки", "Финансовый результат и сравнение объектов"],
  },
  {
    id: "portfolio",
    name: "Портфель",
    price: 1490,
    units: 20,
    seats: 0,
    description: "Для управления несколькими объектами",
    features: [
      "Всё из «Собственника»",
      "Ремонты, сметы и приёмка работ",
      "Публикация предложений, отклики и показы",
    ],
  },
  {
    id: "team",
    name: "Команда",
    price: 3490,
    units: 50,
    seats: 5,
    description: "Для работы с помощниками",
    features: [
      "Всё из «Портфеля»",
      "До 5 управляющих и наблюдателей",
      "Доступ к выбранным объектам и журнал команды",
    ],
  },
];

export const UNAVAILABLE_BILLING: BillingOverview = {
  available: false,
  mode: "prelaunch",
  launched_at: null,
  notice_until: null,
  plan: "start",
  paid_until: null,
  trial_until: null,
  units_used: 0,
  seats_used: 0,
};

function timestamp(value: string | null): number {
  return value === null ? 0 : Date.parse(value);
}

export function billingGraceUntil(overview: BillingOverview): string | null {
  const paid = timestamp(overview.paid_until);
  return paid > 0 ? new Date(paid + BILLING_GRACE_DAYS * DAY).toISOString() : null;
}

/** Informational only: all authorization and quota checks are enforced in the database. */
export function billingPhase(
  overview: BillingOverview,
  now: Date | number = Date.now(),
): BillingPhase {
  if (!overview.available) return "unavailable";
  if (overview.mode === "prelaunch") return "prelaunch";
  const at = Number(now);
  if (timestamp(overview.notice_until) > at) return "notice";
  const paid = timestamp(overview.paid_until);
  if (overview.plan !== "start" && paid > at) return "active";
  if (overview.plan !== "start" && paid > 0 && paid + BILLING_GRACE_DAYS * DAY > at) return "grace";
  if (timestamp(overview.trial_until) > at) return "trial";
  if (overview.plan !== "start" || overview.units_used > 1 || overview.seats_used > 0)
    return "restricted";
  return "free";
}

export function getBillingAccess(overview: BillingOverview, now: Date | number = Date.now()) {
  const phase = billingPhase(overview, now);
  const unrestricted = phase === "prelaunch" || phase === "notice";
  const effectivePlan: BillingPlanId = unrestricted
    ? "team"
    : phase === "trial"
      ? "portfolio"
      : phase === "active" || phase === "grace"
        ? overview.plan
        : "start";
  const plan = BILLING_PLANS.find((item) => item.id === effectivePlan)!;
  const known = overview.available;
  return {
    phase,
    effectivePlan,
    unrestricted,
    canCreateUnits: known && (unrestricted || overview.units_used < plan.units),
    canInvite: known && (unrestricted || (plan.seats > 0 && overview.seats_used < plan.seats)),
    canCreateExpenses: known && (unrestricted || effectivePlan !== "start"),
    canCreateRepairs: known && (unrestricted || ["portfolio", "team"].includes(effectivePlan)),
    canPublishListings: known && (unrestricted || ["portfolio", "team"].includes(effectivePlan)),
    canStartLease: known && (unrestricted || overview.units_used <= plan.units),
    graceUntil: billingGraceUntil(overview),
  };
}

export function parseBillingOverview(data: unknown): BillingOverview {
  if (!data || typeof data !== "object") throw new Error("Не удалось прочитать статус доступа.");
  const value = data as Record<string, unknown>;
  if (
    !["prelaunch", "enforced"].includes(String(value["mode"])) ||
    !BILLING_PLANS.some((plan) => plan.id === value["plan"]) ||
    !["launched_at", "notice_until", "paid_until", "trial_until"].every(
      (key) =>
        value[key] === null ||
        (typeof value[key] === "string" && Number.isFinite(Date.parse(value[key]))),
    ) ||
    !["units_used", "seats_used"].every(
      (key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0,
    )
  )
    throw new Error("Статус доступа загрузился не полностью. Обновите страницу.");
  return {
    available: true,
    mode: value["mode"] as BillingMode,
    launched_at: value["launched_at"] as string | null,
    notice_until: value["notice_until"] as string | null,
    plan: value["plan"] as BillingPlanId,
    paid_until: value["paid_until"] as string | null,
    trial_until: value["trial_until"] as string | null,
    units_used: value["units_used"] as number,
    seats_used: value["seats_used"] as number,
  };
}
