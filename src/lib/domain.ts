export type PropertyType = "apartment" | "warehouse" | "commercial" | "other";
export type RequestCategory = "repair" | "question" | "payment" | "other";
export type RequestStatus = "new" | "in_progress" | "closed";
export type PaymentStatus = "pending" | "partial" | "paid" | "overdue";
export type AgreementStatus = "draft" | "pending_signature" | "active" | "completed";
export type AppRole = "admin" | "owner" | "tenant";
export type NotificationKind =
  | "request_created"
  | "request_comment"
  | "request_status"
  | "agreement_created"
  | "agreement_status"
  | "agreement_accepted"
  | "agreement_expiring"
  | "payment_status"
  | "payment_due"
  | "payment_overdue"
  | "payment_reminder"
  | "payment_reported"
  | "payment_report_status"
  | "utility_submitted"
  | "utility_reviewed"
  | "handover_status"
  | "agreement_amendment";
export type NotificationHref =
  | "/requests"
  | "/payments"
  | "/agreements"
  | "/cabinet"
  | "/utilities"
  | "/handover"
  | "/lease-changes";

export const propertyTypeLabels: Record<PropertyType, string> = {
  apartment: "Квартира / апартаменты",
  warehouse: "Склад",
  commercial: "Коммерческое помещение",
  other: "Другое",
};

export const requestCategoryLabels: Record<RequestCategory, string> = {
  repair: "Ремонт",
  question: "Вопрос",
  payment: "Оплата",
  other: "Другое",
};

export const requestStatusLabels: Record<RequestStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  closed: "Закрыта",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: "Ожидается",
  partial: "Частично оплачено",
  paid: "Оплачено",
  overdue: "Просрочено",
};

export const agreementStatusLabels: Record<AgreementStatus, string> = {
  draft: "Черновик",
  pending_signature: "На подписании",
  active: "Активен",
  completed: "Завершён",
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Администратор",
  owner: "Собственник",
  tenant: "Арендатор",
};

export const notificationKindLabels: Record<NotificationKind, string> = {
  request_created: "Новая заявка",
  request_comment: "Комментарий",
  request_status: "Статус заявки",
  agreement_created: "Договор",
  agreement_status: "Статус договора",
  agreement_amendment: "Изменение условий",
  agreement_accepted: "Подтверждение договора",
  agreement_expiring: "Срок договора",
  payment_status: "Оплата",
  payment_due: "Срок оплаты",
  payment_overdue: "Просрочка",
  payment_reminder: "Напоминание об оплате",
  payment_reported: "Сообщение об оплате",
  payment_report_status: "Статус оплаты",
  utility_submitted: "Коммунальные показания",
  utility_reviewed: "Коммунальный расчёт",
  handover_status: "Заселение и выезд",
};

export function formatMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDefaultLeaseDates(referenceDate = new Date()) {
  const start = new Date(referenceDate);
  const end = new Date(referenceDate);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);

  return {
    startDate: localDateKey(start),
    endDate: localDateKey(end),
  };
}

export function getRenewalLeaseDates(currentEndDate: string) {
  const start = new Date(`${currentEndDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new Error("Некорректная дата окончания договора");

  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function calendarDaysBetween(from: string, to: string) {
  const fromTimestamp = Date.parse(`${from}T00:00:00Z`);
  const toTimestamp = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toTimestamp - fromTimestamp) / 86_400_000);
}

export function formatMonth(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

export function getPaymentStatus(charge: {
  paid_at: string | null;
  paid_amount?: number | null;
  due_date: string;
}): PaymentStatus {
  if (charge.paid_at) return "paid";
  if (Number(charge.paid_amount ?? 0) > 0) return "partial";
  return charge.due_date < localDateKey() ? "overdue" : "pending";
}

export function getRentChargeTotal(charge: { amount: number; adjustment_amount?: number | null }) {
  return Number(charge.amount) + Number(charge.adjustment_amount ?? 0);
}

export function getRentChargeBalance(charge: {
  amount: number;
  adjustment_amount?: number | null;
  paid_amount?: number | null;
  paid_at?: string | null;
}) {
  const total = getRentChargeTotal(charge);
  const paid =
    charge.paid_amount == null && charge.paid_at ? total : Number(charge.paid_amount ?? 0);
  return Math.max(0, total - paid);
}

export function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}
