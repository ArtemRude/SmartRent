SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.lease_agreements
  ADD COLUMN IF NOT EXISTS payment_due_day smallint;

UPDATE public.lease_agreements
SET payment_due_day = CASE
  WHEN contract_details ->> 'paymentDueDay' ~ '^[0-9]{1,2}$' THEN
    CASE
      WHEN (contract_details ->> 'paymentDueDay')::integer BETWEEN 1 AND 31
        THEN (contract_details ->> 'paymentDueDay')::smallint
      ELSE EXTRACT(DAY FROM start_date)::smallint
    END
  ELSE EXTRACT(DAY FROM start_date)::smallint
END
WHERE payment_due_day IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lease_payment_due_day_valid'
      AND conrelid = 'public.lease_agreements'::regclass
  ) THEN
    ALTER TABLE public.lease_agreements
      ADD CONSTRAINT lease_payment_due_day_valid CHECK (
        payment_due_day IS NULL OR payment_due_day BETWEEN 1 AND 31
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.lease_agreements
  VALIDATE CONSTRAINT lease_payment_due_day_valid;

CREATE OR REPLACE FUNCTION private.sync_rent_charges_for_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Paid and previous calendar months remain immutable. Recalculate only the
  -- unpaid current/future schedule when contract billing terms change.
  DELETE FROM public.rent_charges AS charge
  WHERE charge.agreement_id = NEW.id
    AND charge.paid_at IS NULL
    AND charge.period_start >= date_trunc('month', CURRENT_DATE)::date;

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

DROP TRIGGER IF EXISTS sync_rent_charges_after_agreement_change
  ON public.lease_agreements;
CREATE TRIGGER sync_rent_charges_after_agreement_change
  AFTER INSERT OR UPDATE OF
    start_date,
    end_date,
    monthly_payment,
    payment_due_day,
    status,
    owner_id,
    tenant_id
  ON public.lease_agreements
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_rent_charges_for_agreement();

-- Bring the current and future unpaid schedule in line with the stored terms.
UPDATE public.rent_charges AS charge
SET due_date = LEAST(
  charge.period_start
    + (COALESCE(agreement.payment_due_day, EXTRACT(DAY FROM agreement.start_date)::integer) - 1),
  (charge.period_start + INTERVAL '1 month - 1 day')::date
)
FROM public.lease_agreements AS agreement
WHERE charge.agreement_id = agreement.id
  AND charge.paid_at IS NULL
  AND charge.period_start >= date_trunc('month', CURRENT_DATE)::date;
