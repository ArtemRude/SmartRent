-- Trigger deployment after correcting the Supabase GitHub working directory.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.rent_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  due_date date NOT NULL,
  amount numeric(14, 2) NOT NULL,
  paid_at timestamptz,
  payment_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_charges_amount_nonnegative CHECK (amount >= 0),
  CONSTRAINT rent_charges_period_is_month_start
    CHECK (period_start = date_trunc('month', period_start)::date),
  CONSTRAINT rent_charges_note_length CHECK (char_length(payment_note) <= 1000),
  CONSTRAINT rent_charges_agreement_period_unique UNIQUE (agreement_id, period_start)
);

ALTER TABLE public.rent_charges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rent_charges FROM anon, authenticated;
GRANT SELECT ON public.rent_charges TO authenticated;
GRANT UPDATE (paid_at, payment_note) ON public.rent_charges TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent_charges TO service_role;

DROP POLICY IF EXISTS "rent_charges_admin_select" ON public.rent_charges;
CREATE POLICY "rent_charges_admin_select"
  ON public.rent_charges
  FOR SELECT
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "rent_charges_admin_update" ON public.rent_charges;
CREATE POLICY "rent_charges_admin_update"
  ON public.rent_charges
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

DROP POLICY IF EXISTS "rent_charges_owner_select" ON public.rent_charges;
CREATE POLICY "rent_charges_owner_select"
  ON public.rent_charges
  FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "rent_charges_owner_update" ON public.rent_charges;
CREATE POLICY "rent_charges_owner_update"
  ON public.rent_charges
  FOR UPDATE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "rent_charges_tenant_select" ON public.rent_charges;
CREATE POLICY "rent_charges_tenant_select"
  ON public.rent_charges
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_my_tenant_record(tenant_id)));

CREATE INDEX IF NOT EXISTS rent_charges_owner_due_idx
  ON public.rent_charges(owner_id, due_date DESC);
CREATE INDEX IF NOT EXISTS rent_charges_tenant_due_idx
  ON public.rent_charges(tenant_id, due_date DESC);
CREATE INDEX IF NOT EXISTS rent_charges_owner_unpaid_due_idx
  ON public.rent_charges(owner_id, due_date)
  WHERE paid_at IS NULL;

CREATE OR REPLACE FUNCTION private.sync_rent_charges_for_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Keep paid periods and historical debt immutable. Only the unpaid future
  -- schedule is recalculated when a contract changes or is archived.
  DELETE FROM public.rent_charges AS charge
  WHERE charge.agreement_id = NEW.id
    AND charge.paid_at IS NULL
    AND charge.due_date >= CURRENT_DATE;

  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.rent_charges (
    agreement_id,
    owner_id,
    tenant_id,
    period_start,
    due_date,
    amount
  )
  SELECT
    NEW.id,
    NEW.owner_id,
    NEW.tenant_id,
    months.period_start::date,
    LEAST(
      months.period_start::date + (EXTRACT(DAY FROM NEW.start_date)::integer - 1),
      (months.period_start + INTERVAL '1 month - 1 day')::date
    ),
    NEW.monthly_payment::numeric(14, 2)
  FROM generate_series(
    date_trunc('month', NEW.start_date::timestamp),
    date_trunc('month', NEW.end_date::timestamp),
    INTERVAL '1 month'
  ) AS months(period_start)
  ON CONFLICT (agreement_id, period_start) DO UPDATE
  SET
    owner_id = EXCLUDED.owner_id,
    tenant_id = EXCLUDED.tenant_id,
    due_date = EXCLUDED.due_date,
    amount = EXCLUDED.amount
  WHERE public.rent_charges.paid_at IS NULL
    AND public.rent_charges.due_date >= CURRENT_DATE;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.sync_rent_charges_for_agreement()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS sync_rent_charges_after_agreement_change
  ON public.lease_agreements;
CREATE TRIGGER sync_rent_charges_after_agreement_change
  AFTER INSERT OR UPDATE OF start_date, end_date, monthly_payment, status, owner_id, tenant_id
  ON public.lease_agreements
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_rent_charges_for_agreement();

-- Build the initial schedule for contracts that existed before this migration.
INSERT INTO public.rent_charges (
  agreement_id,
  owner_id,
  tenant_id,
  period_start,
  due_date,
  amount
)
SELECT
  agreement.id,
  agreement.owner_id,
  agreement.tenant_id,
  months.period_start::date,
  LEAST(
    months.period_start::date + (EXTRACT(DAY FROM agreement.start_date)::integer - 1),
    (months.period_start + INTERVAL '1 month - 1 day')::date
  ),
  agreement.monthly_payment::numeric(14, 2)
FROM public.lease_agreements AS agreement
CROSS JOIN LATERAL generate_series(
  date_trunc('month', agreement.start_date::timestamp),
  date_trunc('month', agreement.end_date::timestamp),
  INTERVAL '1 month'
) AS months(period_start)
WHERE agreement.status = 'active'
ON CONFLICT (agreement_id, period_start) DO NOTHING;
