SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.payment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.rent_charges(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  amount numeric(14, 2) NOT NULL,
  paid_at timestamptz NOT NULL,
  payment_method text NOT NULL,
  receipt_file text,
  note text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  payment_id uuid REFERENCES public.rent_payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_reports_amount_positive CHECK (amount > 0),
  CONSTRAINT payment_reports_method_valid CHECK (payment_method IN ('bank_transfer', 'cash')),
  CONSTRAINT payment_reports_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT payment_reports_receipt_required CHECK (
    (payment_method = 'bank_transfer' AND receipt_file IS NOT NULL)
    OR (payment_method = 'cash' AND receipt_file IS NULL)
  ),
  CONSTRAINT payment_reports_receipt_file_length CHECK (
    receipt_file IS NULL OR char_length(receipt_file) BETWEEN 1 AND 1000
  ),
  CONSTRAINT payment_reports_note_length CHECK (char_length(note) <= 1000),
  CONSTRAINT payment_reports_review_note_length CHECK (char_length(review_note) <= 1000),
  CONSTRAINT payment_reports_review_state_valid CHECK (
    (
      status = 'pending'
      AND reviewed_by IS NULL
      AND reviewed_at IS NULL
      AND payment_id IS NULL
    )
    OR (
      status = 'approved'
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND payment_id IS NOT NULL
    )
    OR (
      status = 'rejected'
      AND reviewed_by IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND payment_id IS NULL
    )
  )
);

ALTER TABLE public.payment_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_reports FROM anon, authenticated;
GRANT SELECT ON public.payment_reports TO authenticated;
GRANT INSERT (id, charge_id, owner_id, tenant_id, amount, paid_at, payment_method, receipt_file, note)
  ON public.payment_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_reports TO service_role;

CREATE INDEX payment_reports_owner_status_created_idx
  ON public.payment_reports(owner_id, status, created_at DESC);
CREATE INDEX payment_reports_tenant_created_idx
  ON public.payment_reports(tenant_id, created_at DESC);
CREATE INDEX payment_reports_charge_idx
  ON public.payment_reports(charge_id);
CREATE INDEX payment_reports_reported_by_idx
  ON public.payment_reports(reported_by);
CREATE INDEX payment_reports_reviewed_by_idx
  ON public.payment_reports(reviewed_by)
  WHERE reviewed_by IS NOT NULL;
CREATE UNIQUE INDEX payment_reports_payment_id_idx
  ON public.payment_reports(payment_id)
  WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX payment_reports_one_pending_per_charge_idx
  ON public.payment_reports(charge_id)
  WHERE status = 'pending';

CREATE POLICY "payment_reports_admin_select"
  ON public.payment_reports FOR SELECT TO authenticated
  USING ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY "payment_reports_owner_select"
  ON public.payment_reports FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
CREATE POLICY "payment_reports_tenant_select"
  ON public.payment_reports FOR SELECT TO authenticated
  USING ((SELECT private.is_my_tenant_record(tenant_id)));
CREATE POLICY "payment_reports_tenant_insert"
  ON public.payment_reports FOR INSERT TO authenticated
  WITH CHECK (
    reported_by = (SELECT auth.uid())
    AND (SELECT private.is_my_tenant_record(tenant_id))
    AND EXISTS (
      SELECT 1
      FROM public.rent_charges AS charge
      WHERE charge.id = charge_id
        AND charge.owner_id = owner_id
        AND charge.tenant_id = tenant_id
        AND charge.paid_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION private.validate_payment_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  charge_row public.rent_charges%ROWTYPE;
  tenant_user_id uuid;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT charge.*
  INTO charge_row
  FROM public.rent_charges AS charge
  WHERE charge.id = NEW.charge_id
  FOR UPDATE;

  SELECT tenant.user_id
  INTO tenant_user_id
  FROM public.tenants AS tenant
  WHERE tenant.id = NEW.tenant_id;

  IF NOT FOUND
    OR tenant_user_id IS DISTINCT FROM caller_id
    OR charge_row.id IS NULL
    OR charge_row.owner_id <> NEW.owner_id
    OR charge_row.tenant_id <> NEW.tenant_id
  THEN
    RAISE EXCEPTION 'payment report does not match tenant charge'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.paid_at::date > CURRENT_DATE THEN
    RAISE EXCEPTION 'payment date cannot be in the future'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.amount > charge_row.amount + charge_row.adjustment_amount - charge_row.paid_amount THEN
    RAISE EXCEPTION 'reported amount exceeds remaining charge balance'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.payment_method = 'bank_transfer'
    AND split_part(NEW.receipt_file, '/', 1) <> caller_id::text
  THEN
    RAISE EXCEPTION 'receipt must be uploaded to the current user folder'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.note := NULLIF(btrim(NEW.note), '');
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION private.validate_payment_report()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_payment_report_before_insert
  BEFORE INSERT ON public.payment_reports
  FOR EACH ROW EXECUTE FUNCTION private.validate_payment_report();

CREATE OR REPLACE FUNCTION private.notify_payment_report_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.notifications (
    user_id, kind, title, body, href, entity_type, entity_id, dedupe_key
  )
  VALUES (
    NEW.owner_id,
    'payment_reported',
    'Арендатор сообщил об оплате',
    CASE NEW.payment_method
      WHEN 'cash' THEN 'Наличными: ' || NEW.amount::text || ' ₽'
      ELSE 'Банковским переводом: ' || NEW.amount::text || ' ₽. Проверьте чек.'
    END,
    '/payments',
    'rent_charge',
    NEW.charge_id,
    'payment_reported:' || NEW.id::text
  );

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION private.notify_payment_report_created()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER notify_payment_report_after_insert
  AFTER INSERT ON public.payment_reports
  FOR EACH ROW EXECUTE FUNCTION private.notify_payment_report_created();

CREATE OR REPLACE FUNCTION private.validate_rent_payment_receipt_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.receipt_file IS NOT NULL
    AND split_part(NEW.receipt_file, '/', 1) <> (SELECT auth.uid())::text
    AND NOT EXISTS (
      SELECT 1
      FROM public.payment_reports AS report
      WHERE report.charge_id = NEW.charge_id
        AND report.receipt_file = NEW.receipt_file
        AND report.status = 'pending'
        AND report.owner_id = (SELECT auth.uid())
    )
  THEN
    RAISE EXCEPTION 'receipt must be uploaded by the current user or submitted by the tenant'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

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
      charge_id, owner_id, tenant_id, amount, paid_at, note, receipt_file, created_by
    )
    VALUES (
      report_row.charge_id,
      report_row.owner_id,
      report_row.tenant_id,
      report_row.amount,
      report_row.paid_at,
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

CREATE OR REPLACE FUNCTION private.reject_payment_report_before_payment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  report_id uuid;
  report_tenant_id uuid;
  report_charge_id uuid;
  tenant_user_id uuid;
BEGIN
  UPDATE public.payment_reports
  SET
    status = 'rejected',
    payment_id = NULL,
    reviewed_at = now(),
    review_note = 'Подтверждённый платёж удалён собственником'
  WHERE payment_id = OLD.id
  RETURNING id, tenant_id, charge_id
  INTO report_id, report_tenant_id, report_charge_id;

  IF FOUND THEN
    SELECT tenant.user_id
    INTO tenant_user_id
    FROM public.tenants AS tenant
    WHERE tenant.id = report_tenant_id;

    IF tenant_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, kind, title, body, href, entity_type, entity_id, dedupe_key
      )
      VALUES (
        tenant_user_id,
        'payment_report_status',
        'Подтверждение оплаты отменено',
        'Собственник удалил ранее подтверждённый платёж. Проверьте задолженность.',
        '/cabinet',
        'rent_charge',
        report_charge_id,
        'payment_report_status:' || report_id::text || ':payment_deleted'
      );
    END IF;
  END IF;

  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION private.reject_payment_report_before_payment_delete()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER reject_payment_report_before_payment_delete
  BEFORE DELETE ON public.rent_payments
  FOR EACH ROW EXECUTE FUNCTION private.reject_payment_report_before_payment_delete();

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_valid CHECK (
    kind IN (
      'request_created',
      'request_comment',
      'request_status',
      'agreement_created',
      'agreement_status',
      'agreement_accepted',
      'agreement_expiring',
      'payment_status',
      'payment_due',
      'payment_overdue',
      'payment_reminder',
      'payment_reported',
      'payment_report_status'
    )
  ) NOT VALID;
ALTER TABLE public.notifications
  VALIDATE CONSTRAINT notifications_kind_valid;

DROP POLICY IF EXISTS "payment_receipts_insert_owner" ON storage.objects;
CREATE POLICY "payment_receipts_insert_participant"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      (SELECT private.has_role((SELECT auth.uid()), 'owner'::public.app_role))
      OR (SELECT private.has_role((SELECT auth.uid()), 'tenant'::public.app_role))
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    )
  );

DROP POLICY IF EXISTS "payment_receipts_select_authorized" ON storage.objects;
CREATE POLICY "payment_receipts_select_authorized"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR EXISTS (
        SELECT 1
        FROM public.rent_payments AS payment
        WHERE payment.receipt_file = objects.name
          AND (
            payment.owner_id = (SELECT auth.uid())
            OR private.is_my_tenant_record(payment.tenant_id)
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.payment_reports AS report
        WHERE report.receipt_file = objects.name
          AND (
            report.owner_id = (SELECT auth.uid())
            OR private.is_my_tenant_record(report.tenant_id)
          )
      )
    )
  );

DROP POLICY IF EXISTS "payment_receipts_delete_uploader" ON storage.objects;
CREATE POLICY "payment_receipts_delete_unattached_uploader"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND owner_id = (SELECT auth.uid())::text
    AND NOT EXISTS (
      SELECT 1 FROM public.rent_payments AS payment WHERE payment.receipt_file = objects.name
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_reports AS report WHERE report.receipt_file = objects.name
    )
  );
