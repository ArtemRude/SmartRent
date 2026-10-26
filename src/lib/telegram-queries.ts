import { supabase } from "@/integrations/supabase/client";
import type { TelegramLink, TelegramOverview, TelegramTopic } from "./telegram";
import { telegramBotLink } from "./telegram";

export const telegramQueryKey = (userId: string) => ["telegram", userId] as const;
function telegramError(error: { code?: string; message?: string }) {
  if (error.code === "42501" || error.code === "PGRST301")
    return new Error("Доступ к настройкам Telegram недоступен. Войдите в аккаунт заново.");
  if (error.code === "54000" || (error.code === "P0001" && error.message?.includes("minute")))
    return new Error("Проверочное сообщение можно отправлять раз в минуту.");
  return new Error(
    "Не удалось выполнить действие с Telegram. Обновите настройки и попробуйте ещё раз.",
  );
}
export async function fetchTelegramOverview(signal?: AbortSignal) {
  let query = supabase.rpc("telegram_overview");
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error?.code === "PGRST202") return { available: false as const, overview: null };
  if (error) throw telegramError(error);
  const overview = data as unknown as TelegramOverview;
  if (
    !overview ||
    typeof overview.configured !== "boolean" ||
    typeof overview.enabled !== "boolean" ||
    !Array.isArray(overview.topics) ||
    !Array.isArray(overview.deliveries)
  )
    throw new Error("Не удалось загрузить настройки Telegram целиком.");
  return { available: true as const, overview };
}
export async function beginTelegramLink() {
  const { data, error } = await supabase.rpc("begin_telegram_link");
  if (error) throw telegramError(error);
  const link = data as unknown as TelegramLink;
  if (!link || !link.id || !Number.isFinite(Date.parse(link.expires_at)))
    throw new Error("Не удалось создать ссылку подключения Telegram.");
  telegramBotLink(link);
  return link;
}
export async function confirmTelegramLink(id: string) {
  const { error } = await supabase.rpc("confirm_telegram_link", { p_id: id });
  if (error) throw telegramError(error);
}
export async function disconnectTelegram() {
  const { error } = await supabase.rpc("disconnect_telegram");
  if (error) throw telegramError(error);
}
export async function saveTelegramPreferences(enabled: boolean, topics: TelegramTopic[]) {
  const { error } = await supabase.rpc("save_telegram_preferences", {
    p_enabled: enabled,
    p_topics: topics,
  });
  if (error) throw telegramError(error);
}
export async function testTelegramDelivery() {
  const { error } = await supabase.rpc("test_telegram_delivery");
  if (error) throw telegramError(error);
}
