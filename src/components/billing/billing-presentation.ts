import { billingGraceUntil, billingPhase, type BillingOverview } from "@/lib/billing";
import { formatDate } from "@/lib/domain";

export function billingPresentation(overview: BillingOverview) {
  const phase = billingPhase(overview);
  const graceUntil = billingGraceUntil(overview);

  const states = {
    prelaunch: {
      label: "Ранний доступ",
      title: "Ранний доступ: все возможности бесплатны",
      description:
        "Пользуйтесь всеми разделами без тарифных ограничений. Оплата не требуется. Платные условия начнут действовать после запуска, о переходе сообщим заранее.",
      tone: "positive",
    },
    notice: {
      label: "Переходный период",
      title: "Есть время выбрать подходящий тариф",
      description: `Все возможности пока доступны бесплатно. Переходный период действует до ${formatDate(overview.notice_until)}. До этой даты тарифные ограничения не применяются.`,
      tone: "positive",
    },
    trial: {
      label: "Пробный период",
      title: "Пробный доступ активен",
      description: `Возможности вашего тарифа доступны до ${formatDate(overview.trial_until)}. После пробы деньги автоматически не списываются.`,
      tone: "positive",
    },
    active: {
      label: "Подписка активна",
      title: "Ваш тариф оплачен",
      description: `Оплаченный доступ действует до ${formatDate(overview.paid_until)}. Для изменения или продления тарифа обратитесь в поддержку.`,
      tone: "positive",
    },
    grace: {
      label: "Ожидает продления",
      title: "Подписка закончилась — доступ пока сохраняется",
      description: `Льготный период действует до ${formatDate(graceUntil)}. Продлите подписку в течение 7 дней после окончания оплаченного срока, чтобы сохранить возможности тарифа.`,
      tone: "warning",
    },
    restricted: {
      label: "Ограниченный доступ",
      title: "Для новых платных действий нужно продление",
      description:
        "История, учёт платежей, заявки и работа по действующим обязательствам остаются доступны. Создание новых платных процессов и расширение лимитов приостановлены до продления.",
      tone: "warning",
    },
    free: {
      label: "Бесплатный тариф",
      title: "Вы на тарифе «Старт»",
      description:
        "Базовые возможности для одной единицы аренды доступны бесплатно. Для большего числа помещений и дополнительных модулей выберите подходящий тариф.",
      tone: "neutral",
    },
    unavailable: {
      label: "Статус уточняется",
      title: "Не удалось получить условия доступа",
      description:
        "Сведения о тарифе временно недоступны. Обновите страницу или обратитесь в поддержку; ваши данные сохраняются.",
      tone: "neutral",
    },
  } as const;

  return { phase, ...states[phase] };
}
