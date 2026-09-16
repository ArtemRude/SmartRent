-- Let tenants withdraw their own payment report until the owner reviews it.
ALTER TABLE public.payment_reports
  ADD COLUMN cancelled_at timestamptz;

ALTER TABLE public.payment_reports
  DROP CONSTRAINT payment_reports_status_valid,
  DROP CONSTRAINT payment_reports_review_state_valid,
  ADD CONSTRAINT payment_reports_status_valid
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  ADD CONSTRAINT payment_reports_review_state_valid CHECK (
    (
      status = 'pending'
      AND reviewed_by IS NULL
      AND reviewed_at IS NULL
      AND cancelled_at IS NULL
      AND payment_id IS NULL
    )
    OR (
      status = 'approved'
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND cancelled_at IS NULL
      AND payment_id IS NOT NULL
    )
    OR (
      status = 'rejected'
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND cancelled_at IS NULL
      AND payment_id IS NULL
    )
    OR (
      status = 'cancelled'
      AND reviewed_by IS NULL
      AND reviewed_at IS NULL
      AND cancelled_at IS NOT NULL
      AND payment_id IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.cancel_payment_report(p_report_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  report_owner_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.payment_reports
  SET
    status = 'cancelled',
    cancelled_at = now()
  WHERE id = p_report_id
    AND reported_by = caller_id
    AND status = 'pending'
  RETURNING owner_id INTO report_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment report is unavailable' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.notifications
  WHERE user_id = report_owner_id
    AND kind = 'payment_reported'
    AND dedupe_key = 'payment_reported:' || p_report_id::text;

  RETURN 'cancelled';
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_payment_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_payment_report(uuid) TO authenticated;
