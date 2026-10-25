import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseBillingOverview, UNAVAILABLE_BILLING, type BillingPlanId } from "./billing";

// Keep the generated database types owned by other in-progress work untouched.
// This local interface is restricted to the billing RPCs defined by our migration.
type BillingRpcArgs = {
  billing_overview: undefined;
  billing_admin_launch: { p_confirm: boolean };
  billing_admin_pause: undefined;
  billing_admin_set_subscription: {
    p_owner_id: string;
    p_plan: BillingPlanId;
    p_paid_until: string | null;
  };
};
type BillingRpcError = { code?: string; message: string };
type BillingRpcResult = { data: unknown; error: BillingRpcError | null };
const billingRpc = <Name extends keyof BillingRpcArgs>(name: Name, args: BillingRpcArgs[Name]) =>
  (
    supabase.rpc as unknown as (
      name: Name,
      args: BillingRpcArgs[Name],
    ) => PromiseLike<BillingRpcResult>
  )(name, args);

export function billingQueryOptions(userId?: string) {
  return queryOptions({
    queryKey: ["billing", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await billingRpc("billing_overview", undefined);
      if (error?.code === "PGRST202") return { ...UNAVAILABLE_BILLING };
      if (error) throw new Error("Не удалось загрузить статус доступа. Попробуйте ещё раз.");
      return parseBillingOverview(data);
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

function adminError(error: BillingRpcError) {
  return new Error(
    error.code === "42501"
      ? "Изменять платный режим может только администратор платформы."
      : "Не удалось изменить настройки. Обновите страницу и попробуйте ещё раз.",
  );
}

export async function launchBilling() {
  const { error } = await billingRpc("billing_admin_launch", { p_confirm: true });
  if (error) throw adminError(error);
}

export async function pauseBilling() {
  const { error } = await billingRpc("billing_admin_pause", undefined);
  if (error) throw adminError(error);
}

export async function setBillingSubscription(
  ownerId: string,
  plan: BillingPlanId,
  paidUntil: string | null,
) {
  const { error } = await billingRpc("billing_admin_set_subscription", {
    p_owner_id: ownerId,
    p_plan: plan,
    p_paid_until: paidUntil,
  });
  if (error) throw adminError(error);
}
