SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.rent_charges
  ADD COLUMN adjustment_amount numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN adjustment_reason text,
  ADD COLUMN adjusted_at timestamptz,
  ADD COLUMN adjusted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT rent_charges_total_nonnegative
    CHECK (amount + adjustment_amount >= 0),
  ADD CONSTRAINT rent_charges_adjustment_reason_length
    CHECK (char_length(adjustment_reason) <= 1000),
  ADD CONSTRAINT rent_charges_adjustment_reason_required
    CHECK (
      adjustment_amount = 0
      OR NULLIF(btrim(adjustment_reason), '') IS NOT NULL
    );

CREATE TABLE public.rent_charge_adjustment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.rent_charges(id) ON DELETE CASCADE,
  previous_adjustment_amount numeric(14, 2) NOT NULL,
  adjustment_amount numeric(14, 2) NOT NULL,
  reason text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_charge_adjustment_events_reason_nonempty
    CHECK (NULLIF(btrim(reason), '') IS NOT NULL),
  CONSTRAINT rent_charge_adjustment_events_reason_length
    CHECK (char_length(reason) <= 1000)
);

ALTER TABLE public.rent_charge_adjustment_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rent_charge_adjustment_events FROM anon, authenticated;
GRANT SELECT ON public.rent_charge_adjustment_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent_charge_adjustment_events TO service_role;

CREATE POLICY "rent_charge_adjustment_events_participant_select"
  ON public.rent_charge_adjustment_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.rent_charges AS charge
      WHERE charge.id = rent_charge_adjustment_events.charge_id
    )
  );

CREATE INDEX rent_charge_adjustment_events_charge_created_idx
  ON public.rent_charge_adjustment_events(charge_id, created_at DESC);
CREATE INDEX rent_charge_adjustment_events_changed_by_idx
  ON public.rent_charge_adjustment_events(changed_by)
  WHERE changed_by IS NOT NULL;
CREATE INDEX rent_charges_adjusted_by_idx
  ON public.rent_charges(adjusted_by)
  WHERE adjusted_by IS NOT NULL;

CREATE OR REPLACE FUNCTION private.sync_rent_charges_for_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Remove only periods that no longer belong to the active schedule. Existing
  -- periods are updated in place so their manual adjustment and audit survive
  -- changes to the base rent or due day.
  DELETE FROM public.rent_charges AS charge
  WHERE charge.agreement_id = NEW.id
    AND charge.paid_at IS NULL
    AND charge.period_start >= date_trunc('month', CURRENT_DATE)::date
    AND (
      NEW.status <> 'active'
      OR charge.period_start < date_trunc('month', NEW.start_date)::date
      OR charge.period_start > date_trunc('month', NEW.end_date)::date
    );

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
      months.period_start::date
        + (COALESCE(NEW.payment_due_day, EXTRACT(DAY FROM NEW.start_date)::integer) - 1),
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
    AND public.rent_charges.period_start >= date_trunc('month', CURRENT_DATE)::date;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.sync_rent_charges_for_agreement()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.audit_rent_charge_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'paid rent charges cannot be adjusted'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NULLIF(btrim(NEW.adjustment_reason), '') IS NULL
    OR (
      OLD.adjustment_amount IS DISTINCT FROM NEW.adjustment_amount
      AND OLD.adjustment_reason IS NOT DISTINCT FROM NEW.adjustment_reason
    )
  THEN
    RAISE EXCEPTION 'adjustment reason is required'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.adjustment_reason := btrim(NEW.adjustment_reason);
  NEW.adjusted_at := now();
  NEW.adjusted_by := (SELECT auth.uid());

  INSERT INTO public.rent_charge_adjustment_events (
    charge_id,
    previous_adjustment_amount,
    adjustment_amount,
    reason,
    changed_by
  )
  VALUES (
    NEW.id,
    OLD.adjustment_amount,
    NEW.adjustment_amount,
    NEW.adjustment_reason,
    NEW.adjusted_by
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.audit_rent_charge_adjustment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER audit_rent_charge_adjustment_before_update
  BEFORE UPDATE OF adjustment_amount, adjustment_reason
  ON public.rent_charges
  FOR EACH ROW
  WHEN (
    OLD.adjustment_amount IS DISTINCT FROM NEW.adjustment_amount
    OR OLD.adjustment_reason IS DISTINCT FROM NEW.adjustment_reason
  )
  EXECUTE FUNCTION private.audit_rent_charge_adjustment();

GRANT UPDATE (adjustment_amount, adjustment_reason)
  ON public.rent_charges
  TO authenticated;
