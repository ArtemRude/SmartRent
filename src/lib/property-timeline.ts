import { agreementStatusLabels, formatMoney, requestStatusLabels } from "./domain.ts";
import type { Agreement, PropertyTimelineSources, RequestRow, Tenant, Unit } from "./queries.ts";

export type PropertyTimelineKind = "property" | "agreement" | "payment" | "request";

export type PropertyTimelineEvent = {
  id: string;
  kind: PropertyTimelineKind;
  occurredAt: string;
  title: string;
  description: string | null;
  href: "/agreements" | "/payments" | "/requests" | null;
};

type PropertyTimelineInput = PropertyTimelineSources & {
  agreements: Agreement[];
  requests: RequestRow[];
  tenants: Tenant[];
  units: Unit[];
};

function detailString(
  details: PropertyTimelineSources["propertyEvents"][number]["details"],
  key: string,
) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return typeof details[key] === "string" ? details[key] : null;
}

function detailStrings(
  details: PropertyTimelineSources["propertyEvents"][number]["details"],
  key: string,
) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return Array.isArray(details[key])
    ? details[key].filter((value): value is string => typeof value === "string")
    : [];
}

export function buildPropertyTimeline({
  propertyEvents,
  agreementEvents,
  agreementAcceptances,
  requestEvents,
  charges,
  payments,
  agreements,
  requests,
  tenants,
  units,
}: PropertyTimelineInput): PropertyTimelineEvent[] {
  const agreementsById = new Map(agreements.map((agreement) => [agreement.id, agreement]));
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const chargesById = new Map(charges.map((charge) => [charge.id, charge]));
  const tenantDescription = (agreement: Agreement | undefined) => {
    if (!agreement) return null;
    const tenant = tenantsById.get(agreement.tenant_id)?.name ?? "Арендатор";
    const unit = agreement.unit_id ? unitsById.get(agreement.unit_id)?.name : null;
    return unit ? `${tenant} · ${unit}` : tenant;
  };

  const timeline: PropertyTimelineEvent[] = propertyEvents.map((event) => {
    const name = detailString(event.details, "name");
    const fields = detailStrings(event.details, "fields");
    const description = [name, fields.length ? `Изменено: ${fields.join(", ")}` : null]
      .filter(Boolean)
      .join(" · ");
    return {
      id: `property-${event.id}`,
      kind: "property",
      occurredAt: event.created_at,
      title: event.title,
      description: description || null,
      href: null,
    };
  });

  timeline.push(
    ...agreementEvents.map((event) => {
      const agreement = agreementsById.get(event.agreement_id);
      const initial = event.from_status === null;
      return {
        id: `agreement-status-${event.id}`,
        kind: "agreement" as const,
        occurredAt: event.created_at,
        title: initial ? "Создан договор" : "Статус договора изменён",
        description: initial
          ? `${tenantDescription(agreement) ?? "Арендатор"} · ${agreementStatusLabels[event.to_status]}`
          : `${agreementStatusLabels[event.from_status!]} → ${agreementStatusLabels[event.to_status]} · ${tenantDescription(agreement) ?? "Арендатор"}`,
        href: "/agreements" as const,
      };
    }),
    ...agreementAcceptances.map((acceptance) => ({
      id: `agreement-acceptance-${acceptance.id}`,
      kind: "agreement" as const,
      occurredAt: acceptance.accepted_at,
      title: "Договор подписан арендатором",
      description: [
        tenantDescription(agreementsById.get(acceptance.agreement_id)),
        (acceptance.photos ?? []).length
          ? `Приложено фотографий: ${(acceptance.photos ?? []).length}`
          : "Без фотографий",
      ]
        .filter(Boolean)
        .join(" · "),
      href: "/agreements" as const,
    })),
    ...requests.map((request) => ({
      id: `request-created-${request.id}`,
      kind: "request" as const,
      occurredAt: request.created_at,
      title: `Создана заявка «${request.title}»`,
      description: requestStatusLabels.new,
      href: "/requests" as const,
    })),
    ...requestEvents
      .filter((event) => event.from_status !== null)
      .map((event) => ({
        id: `request-status-${event.id}`,
        kind: "request" as const,
        occurredAt: event.created_at,
        title: "Статус заявки изменён",
        description: `${requestsById.get(event.request_id)?.title ?? "Заявка"} · ${requestStatusLabels[event.from_status!]} → ${requestStatusLabels[event.to_status]}`,
        href: "/requests" as const,
      })),
    ...payments.map((payment) => {
      const charge = chargesById.get(payment.charge_id);
      const agreement = charge ? agreementsById.get(charge.agreement_id) : undefined;
      return {
        id: `payment-${payment.id}`,
        kind: "payment" as const,
        occurredAt: payment.paid_at,
        title: `Получена оплата ${formatMoney(payment.amount)}`,
        description: tenantDescription(agreement),
        href: "/payments" as const,
      };
    }),
  );

  return timeline.sort((left, right) => {
    const byDate = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
    return byDate || right.id.localeCompare(left.id);
  });
}
