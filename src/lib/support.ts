import type { Database } from "@/integrations/supabase/types";

export type SupportRequest = Database["public"]["Tables"]["support_requests"]["Row"];
export type SupportCategory = SupportRequest["category"];
export type SupportStatus = SupportRequest["status"];

export const supportCategories: Array<{ value: SupportCategory; label: string }> = [
  { value: "question", label: "Общий вопрос" },
  { value: "access", label: "Вход и доступ" },
  { value: "billing", label: "Оплата и тариф" },
  { value: "technical", label: "Техническая проблема" },
  { value: "other", label: "Другое" },
];

export const supportCategoryLabels = Object.fromEntries(
  supportCategories.map((category) => [category.value, category.label]),
) as Record<SupportCategory, string>;

export const supportStatusLabels: Record<SupportStatus, string> = {
  new: "Новое",
  in_progress: "В работе",
  resolved: "Решено",
};
