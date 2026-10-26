export const telegramTopics = {
  payments: "Платежи",
  agreements: "Договоры и заселение",
  requests: "Заявки и комментарии",
  repairs: "Ремонты",
  recruitment: "Кандидаты на аренду",
  utilities: "Коммунальные услуги",
  objects: "Действия по объекту",
} as const;
export type TelegramTopic = keyof typeof telegramTopics;
export type TelegramDeliveryStatus =
  "pending" | "processing" | "retry" | "sent" | "failed" | "cancelled" | "uncertain";
export type TelegramOverview = {
  configured: boolean;
  bot_username: string | null;
  connection: { username: string | null; connected_at: string } | null;
  pending: { id: string; username: string | null; expires_at: string } | null;
  enabled: boolean;
  topics: TelegramTopic[];
  deliveries: {
    id: string;
    kind: string;
    status: TelegramDeliveryStatus;
    attempts: number;
    created_at: string;
    sent_at: string | null;
    error_code: string | null;
  }[];
  history_truncated: boolean;
};
export type TelegramLink = { id: string; token: string; bot_username: string; expires_at: string };
export const telegramStatusLabels: Record<TelegramDeliveryStatus, string> = {
  pending: "В очереди",
  processing: "Отправляется",
  retry: "Ожидает повторной попытки",
  sent: "Принято Telegram",
  failed: "Не отправлено",
  cancelled: "Отменено",
  uncertain: "Результат неизвестен",
};
export function telegramBotLink(link: TelegramLink) {
  if (
    !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(link.bot_username) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(link.token)
  )
    throw new Error("Не удалось получить безопасную ссылку на бота");
  return `https://t.me/${link.bot_username}?start=${encodeURIComponent(link.token)}`;
}
export function telegramDeliveryExplanation(
  status: TelegramDeliveryStatus,
  errorCode: string | null,
) {
  if (status === "uncertain")
    return "Ответ Telegram не получен. Сообщение могло прийти; автоматического повтора не будет, чтобы избежать дубля.";
  if (status === "sent") return "Telegram принял сообщение. Это не подтверждение прочтения.";
  if (status === "cancelled")
    return "Отправка отменена: изменились настройки, доступ или актуальность события.";
  if (
    errorCode === "bot_blocked" ||
    errorCode === "chat_unavailable" ||
    errorCode === "telegram_403"
  )
    return "Проверьте, что бот не заблокирован, и подключите Telegram заново.";
  if (status === "failed")
    return "Сообщение не удалось отправить. Проверьте подключение и обратитесь к администратору, если ошибка повторится.";
  if (status === "retry") return "Временная ошибка. Сервер повторит отправку автоматически.";
  return "Отправка выполняется сервером, даже если кабинет закрыт.";
}
