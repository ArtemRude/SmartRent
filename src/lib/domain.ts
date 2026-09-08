export type PropertyType = "apartment" | "warehouse" | "commercial" | "other";
export type RequestCategory = "repair" | "question" | "payment" | "other";
export type RequestStatus = "new" | "in_progress" | "closed";
export type PaymentStatus = "pending" | "paid" | "overdue";
export type AppRole = "admin" | "owner" | "tenant";
export type NotificationKind =
  | "request_created"
  | "request_comment"
  | "request_status"
  | "agreement_created"
  | "agreement_expiring"
  | "payment_status"
  | "payment_due"
  | "payment_overdue";
export type NotificationHref = "/requests" | "/payments" | "/agreements" | "/cabinet";

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
  paid: "Оплачено",
  overdue: "Просрочено",
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
  agreement_expiring: "Срок договора",
  payment_status: "Оплата",
  payment_due: "Срок оплаты",
  payment_overdue: "Просрочка",
};

export function formatMoney(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
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

export function formatMonth(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

export function getPaymentStatus(charge: {
  paid_at: string | null;
  due_date: string;
}): PaymentStatus {
  if (charge.paid_at) return "paid";
  return charge.due_date < localDateKey() ? "overdue" : "pending";
}

export function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}
