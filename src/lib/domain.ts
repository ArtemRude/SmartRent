export type PropertyType = "apartment" | "warehouse" | "commercial" | "other";
export type RequestCategory = "repair" | "question" | "payment" | "other";
export type RequestStatus = "new" | "in_progress" | "closed";
export type AppRole = "admin" | "owner" | "tenant";

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

export const roleLabels: Record<AppRole, string> = {
  admin: "Администратор",
  owner: "Собственник",
  tenant: "Арендатор",
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

export function daysUntil(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}
