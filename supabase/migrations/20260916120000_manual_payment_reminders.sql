SET lock_timeout = '5s';
SET statement_timeout = '30s';

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
      'payment_reminder'
    )
  ) NOT VALID;
ALTER TABLE public.notifications
  VALIDATE CONSTRAINT notifications_kind_valid;

CREATE OR REPLACE FUNCTION public.send_payment_reminder(p_agreement_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  tenant_user_id uuid;
  property_name text;
  outstanding_amount numeric;
  oldest_due_date date;
  inserted_count integer;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT tenant.user_id, property.name
  INTO tenant_user_id, property_name
  FROM public.lease_agreements AS agreement
  JOIN public.tenants AS tenant ON tenant.id = agreement.tenant_id
  JOIN public.properties AS property ON property.id = agreement.property_id
  WHERE agreement.id = p_agreement_id
    AND (
      agreement.owner_id = caller_id
      OR private.has_role(caller_id, 'admin'::public.app_role)
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agreement is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(sum(greatest(charge.amount + charge.adjustment_amount - charge.paid_amount, 0)), 0),
    min(charge.due_date)
  INTO outstanding_amount, oldest_due_date
  FROM public.rent_charges AS charge
  WHERE charge.agreement_id = p_agreement_id
    AND charge.paid_at IS NULL
    AND charge.due_date < CURRENT_DATE;

  IF outstanding_amount <= 0 OR oldest_due_date IS NULL THEN
    RETURN 'no_debt';
  END IF;

  IF tenant_user_id IS NULL THEN
    RETURN 'tenant_not_connected';
  END IF;

  INSERT INTO public.notifications (
    user_id,
    kind,
    title,
    body,
    href,
    entity_type,
    entity_id,
    dedupe_key
  )
  VALUES (
    tenant_user_id,
    'payment_reminder',
    'Напоминание об оплате',
    left(
      'Объект «' || property_name || '»: задолженность '
        || outstanding_amount::text || ' ₽ с ' || to_char(oldest_due_date, 'DD.MM.YYYY'),
      1000
    ),
    '/payments',
    'agreement',
    p_agreement_id,
    'payment_reminder:' || p_agreement_id::text || ':' || CURRENT_DATE::text
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN CASE WHEN inserted_count = 1 THEN 'sent' ELSE 'already_sent' END;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_payment_reminder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_payment_reminder(uuid) TO authenticated;

