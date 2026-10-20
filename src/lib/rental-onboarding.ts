import type { Agreement, AgreementAcceptance, Property, RentCharge, Tenant } from "./queries.ts";

type PreparationAgreement = Pick<
  Agreement,
  "id" | "status" | "status_changed_at" | "signed_document_file"
>;
type Acceptance = Pick<AgreementAcceptance, "agreement_id" | "agreement_version">;

export function getAgreementPreparation(
  agreement: PreparationAgreement,
  tenantUserId: string | null | undefined,
  acceptances: readonly Acceptance[],
) {
  const accepted = acceptances.some(
    (item) =>
      item.agreement_id === agreement.id && item.agreement_version === agreement.status_changed_at,
  );
  const steps = [
    { id: "tenant", title: "Кабинет арендатора подключён", completed: Boolean(tenantUserId) },
    {
      id: "sent",
      title: "Договор отправлен на подписание",
      completed: agreement.status !== "draft",
    },
    {
      id: "accepted",
      title: "Арендатор подтвердил текущие условия",
      completed: agreement.status === "pending_signature" && accepted,
    },
    {
      id: "document",
      title: "Подписанный PDF загружен",
      completed: Boolean(agreement.signed_document_file),
    },
  ];
  return {
    steps,
    nextStep: steps.find((step) => !step.completed),
    canActivate: agreement.status === "pending_signature" && steps.every((step) => step.completed),
  };
}

type OnboardingInput = {
  properties: readonly Pick<Property, "id">[];
  tenants: readonly Pick<Tenant, "id" | "user_id">[];
  agreements: readonly (PreparationAgreement & Pick<Agreement, "property_id" | "tenant_id">)[];
  acceptances: readonly Acceptance[];
  charges: readonly Pick<RentCharge, "agreement_id" | "charge_type">[];
};

export function buildRentalOnboarding(input: OnboardingInput) {
  const hasRentCharge = (agreementId: string) =>
    input.charges.some(
      (charge) => charge.agreement_id === agreementId && charge.charge_type !== "utilities",
    );
  const launched = (status: Agreement["status"]) => status === "active" || status === "completed";
  // A successfully launched lease completes first-time setup even if other drafts exist.
  const agreement =
    input.agreements.find((item) => launched(item.status) && hasRentCharge(item.id)) ??
    input.agreements.find((item) => item.status === "active") ??
    input.agreements.find((item) => item.status === "pending_signature") ??
    input.agreements.find((item) => item.status === "draft") ??
    input.agreements[0];
  const tenant = agreement
    ? input.tenants.find((item) => item.id === agreement.tenant_id)
    : input.tenants[0];
  const active = Boolean(agreement && launched(agreement.status));
  const prepared = Boolean(
    agreement &&
    (active || getAgreementPreparation(agreement, tenant?.user_id, input.acceptances).canActivate),
  );
  const agreementSearch = agreement ? { agreementId: agreement.id } : {};
  return [
    {
      title: "Добавьте объект",
      description: "Создайте карточку квартиры, склада или коммерческого помещения.",
      completed: agreement
        ? input.properties.some((item) => item.id === agreement.property_id)
        : input.properties.length > 0,
      to: "/properties" as const,
      search: {},
    },
    {
      title: "Добавьте арендатора",
      description: "Укажите имя и email арендатора.",
      completed: Boolean(tenant),
      to: "/tenants" as const,
      search: {},
    },
    {
      title: "Создайте договор",
      description: "Свяжите объект с арендатором и задайте ежемесячную плату.",
      completed: Boolean(agreement),
      to: "/agreements" as const,
      search: agreementSearch,
    },
    {
      title: "Подготовьте подписание",
      description:
        "Подключите кабинет арендатора, получите подтверждение условий и загрузите подписанный PDF.",
      completed: prepared,
      to: "/agreements" as const,
      search: agreementSearch,
    },
    {
      title: "Активируйте договор",
      description: "После подготовки переведите договор в статус «Активен».",
      completed: active,
      to: "/agreements" as const,
      search: agreementSearch,
    },
    {
      title: "Проверьте начисление",
      description: "Убедитесь, что арендный платёж по этому договору появился в календаре.",
      completed: Boolean(agreement && active && hasRentCharge(agreement.id)),
      to: "/payments" as const,
      search: {},
    },
  ];
}
