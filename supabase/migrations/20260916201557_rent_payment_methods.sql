-- Require a payment method and a bank receipt for every recorded transfer.
ALTER TABLE public.rent_payments
  ADD COLUMN payment_method text;

UPDATE public.rent_payments
SET payment_method = CASE
  WHEN receipt_file IS NULL THEN 'cash'
  ELSE 'bank_transfer'
END;

ALTER TABLE public.rent_payments
  ALTER COLUMN payment_method SET NOT NULL,
  ADD CONSTRAINT rent_payments_method_valid
    CHECK (payment_method IN ('bank_transfer', 'cash')),
  ADD CONSTRAINT rent_payments_receipt_required
    CHECK (
      (payment_method = 'bank_transfer' AND receipt_file IS NOT NULL)
      OR (payment_method = 'cash' AND receipt_file IS NULL)
    );

GRANT INSERT (payment_method) ON public.rent_payments TO authenticated;

CREATE OR REPLACE FUNCTION public.review_payment_report(
  p_report_id uuid,
  p_approve boolean,
  p_review_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  report_row public.payment_reports%ROWTYPE;
  tenant_user_id uuid;
  new_payment_id uuid;
  next_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT report.*
  INTO report_row
  FROM public.payment_reports AS report
  WHERE report.id = p_report_id
    AND report.status = 'pending'
    AND (
      report.owner_id = caller_id
      OR private.has_role(caller_id, 'admin'::public.app_role)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment report is unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_approve THEN
    INSERT INTO public.rent_payments (
      charge_id,
      owner_id,
      tenant_id,
      amount,
      paid_at,
      payment_method,
      note,
      receipt_file,
      created_by
    )
    VALUES (
      report_row.charge_id,
      report_row.owner_id,
      report_row.tenant_id,
      report_row.amount,
      report_row.paid_at,
      report_row.payment_method,
      report_row.note,
      report_row.receipt_file,
      caller_id
    )
    RETURNING id INTO new_payment_id;
  END IF;

  UPDATE public.payment_reports
  SET
    status = next_status,
    reviewed_by = caller_id,
    reviewed_at = now(),
    review_note = NULLIF(btrim(p_review_note), ''),
    payment_id = new_payment_id
  WHERE id = report_row.id;

  SELECT tenant.user_id
  INTO tenant_user_id
  FROM public.tenants AS tenant
  WHERE tenant.id = report_row.tenant_id;

  IF tenant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, kind, title, body, href, entity_type, entity_id, dedupe_key
    )
    VALUES (
      tenant_user_id,
      'payment_report_status',
      CASE WHEN p_approve THEN 'Оплата подтверждена' ELSE 'Оплата не подтверждена' END,
      CASE
        WHEN p_approve THEN 'Собственник подтвердил оплату на сумму ' || report_row.amount::text || ' ₽.'
        ELSE 'Собственник отклонил сообщение об оплате.'
          || CASE
            WHEN NULLIF(btrim(p_review_note), '') IS NULL THEN ''
            ELSE ' Причина: ' || left(btrim(p_review_note), 800)
          END
      END,
      '/cabinet',
      'rent_charge',
      report_row.charge_id,
      'payment_report_status:' || report_row.id::text || ':' || next_status
    );
  END IF;

  RETURN next_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_payment_report(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_payment_report(uuid, boolean, text) TO authenticated;
