-- Record individual rent payments and keep charge totals in sync.
ALTER TABLE public.rent_charges
  ADD COLUMN paid_amount numeric(14, 2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT rent_charges_paid_amount_nonnegative CHECK (paid_amount >= 0);

CREATE OR REPLACE FUNCTION private.sync_rent_charges_for_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.rent_charges AS charge
  WHERE charge.agreement_id = NEW.id
    AND charge.paid_at IS NULL
    AND charge.paid_amount = 0
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
    agreement_id, owner_id, tenant_id, period_start, due_date, amount
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
    AND public.rent_charges.paid_amount = 0
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
  IF OLD.paid_at IS NOT NULL OR OLD.paid_amount > 0 THEN
    RAISE EXCEPTION 'rent charges with payments cannot be adjusted'
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
    charge_id, previous_adjustment_amount, adjustment_amount, reason, changed_by
  )
  VALUES (
    NEW.id, OLD.adjustment_amount, NEW.adjustment_amount, NEW.adjustment_reason, NEW.adjusted_by
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.audit_rent_charge_adjustment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.rent_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.rent_charges(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL,
  paid_at timestamptz NOT NULL,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rent_payments_amount_positive CHECK (amount > 0),
  CONSTRAINT rent_payments_note_length CHECK (char_length(note) <= 1000)
);

ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rent_payments FROM anon, authenticated;
GRANT SELECT ON public.rent_payments TO authenticated;
GRANT INSERT (charge_id, owner_id, tenant_id, amount, paid_at, note)
  ON public.rent_payments TO authenticated;
GRANT UPDATE (amount, paid_at, note) ON public.rent_payments TO authenticated;
GRANT DELETE ON public.rent_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent_payments TO service_role;

CREATE POLICY "rent_payments_admin_select"
  ON public.rent_payments FOR SELECT TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
CREATE POLICY "rent_payments_admin_insert"
  ON public.rent_payments FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
CREATE POLICY "rent_payments_admin_update"
  ON public.rent_payments FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin')));
CREATE POLICY "rent_payments_admin_delete"
  ON public.rent_payments FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin')));

CREATE POLICY "rent_payments_owner_select"
  ON public.rent_payments FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
CREATE POLICY "rent_payments_owner_insert"
  ON public.rent_payments FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.rent_charges AS charge
      WHERE charge.id = charge_id
        AND charge.owner_id = (SELECT auth.uid())
        AND charge.tenant_id = tenant_id
    )
  );
CREATE POLICY "rent_payments_owner_update"
  ON public.rent_payments FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY "rent_payments_owner_delete"
  ON public.rent_payments FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "rent_payments_tenant_select"
  ON public.rent_payments FOR SELECT TO authenticated
  USING ((SELECT public.is_my_tenant_record(tenant_id)));

CREATE INDEX rent_payments_charge_paid_idx
  ON public.rent_payments(charge_id, paid_at DESC);
CREATE INDEX rent_payments_owner_paid_idx
  ON public.rent_payments(owner_id, paid_at DESC);
CREATE INDEX rent_payments_tenant_paid_idx
  ON public.rent_payments(tenant_id, paid_at DESC);

CREATE OR REPLACE FUNCTION private.validate_rent_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  charge_row public.rent_charges%ROWTYPE;
  previous_total numeric(14, 2);
BEGIN
  SELECT * INTO charge_row
  FROM public.rent_charges
  WHERE id = NEW.charge_id
  FOR UPDATE;

  IF NOT FOUND
    OR charge_row.owner_id <> NEW.owner_id
    OR charge_row.tenant_id <> NEW.tenant_id
  THEN
    RAISE EXCEPTION 'payment does not match rent charge'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.paid_at::date > CURRENT_DATE THEN
    RAISE EXCEPTION 'payment date cannot be in the future'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(sum(amount), 0)::numeric(14, 2)
  INTO previous_total
  FROM public.rent_payments
  WHERE charge_id = NEW.charge_id
    AND id <> NEW.id;

  IF previous_total + NEW.amount > charge_row.amount + charge_row.adjustment_amount THEN
    RAISE EXCEPTION 'payment exceeds remaining charge balance'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.note := NULLIF(btrim(NEW.note), '');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.validate_rent_payment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_rent_payment_before_write
  BEFORE INSERT OR UPDATE ON public.rent_payments
  FOR EACH ROW EXECUTE FUNCTION private.validate_rent_payment();

-- Convert existing one-off payment marks into ledger entries.
INSERT INTO public.rent_payments (charge_id, owner_id, tenant_id, amount, paid_at, note, created_by)
SELECT
  id,
  owner_id,
  tenant_id,
  amount + adjustment_amount,
  paid_at,
  payment_note,
  owner_id
FROM public.rent_charges
WHERE paid_at IS NOT NULL
  AND amount + adjustment_amount > 0;

UPDATE public.rent_charges
SET paid_amount = CASE WHEN paid_at IS NULL THEN 0 ELSE amount + adjustment_amount END;

CREATE OR REPLACE FUNCTION private.sync_rent_charge_payment_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_charge_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_charge_id := OLD.charge_id;
  ELSE
    target_charge_id := NEW.charge_id;
  END IF;

  UPDATE public.rent_charges AS charge
  SET
    paid_amount = summary.total,
    paid_at = CASE
      WHEN summary.total >= charge.amount + charge.adjustment_amount
        AND charge.amount + charge.adjustment_amount > 0
      THEN summary.last_paid_at
      ELSE NULL
    END,
    payment_note = summary.last_note
  FROM (
    SELECT
      COALESCE(sum(payment.amount), 0)::numeric(14, 2) AS total,
      max(payment.paid_at) AS last_paid_at,
      (array_agg(payment.note ORDER BY payment.paid_at DESC, payment.created_at DESC)
        FILTER (WHERE payment.note IS NOT NULL))[1] AS last_note
    FROM public.rent_payments AS payment
    WHERE payment.charge_id = target_charge_id
  ) AS summary
  WHERE charge.id = target_charge_id;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.sync_rent_charge_payment_summary()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER sync_rent_charge_after_payment_change
  AFTER INSERT OR UPDATE OR DELETE ON public.rent_payments
  FOR EACH ROW EXECUTE FUNCTION private.sync_rent_charge_payment_summary();

-- Payment summary is derived from the ledger, never edited directly by clients.
REVOKE UPDATE (paid_at, payment_note) ON public.rent_charges FROM authenticated;
