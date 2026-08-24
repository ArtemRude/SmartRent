CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_valid;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_valid CHECK (
    kind IN (
      'request_created',
      'request_comment',
      'request_status',
      'agreement_created',
      'agreement_expiring',
      'payment_status',
      'payment_due',
      'payment_overdue'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notifications_dedupe_key_length'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_dedupe_key_length
      CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 255);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_key_idx
  ON public.notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS rent_charges_unpaid_due_idx
  ON public.rent_charges(due_date)
  WHERE paid_at IS NULL;

CREATE OR REPLACE FUNCTION private.enqueue_rental_reminders(
  p_today date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
DECLARE
  inserted_count integer := 0;
  batch_count integer := 0;
BEGIN
  WITH expiring_agreements AS (
    SELECT
      agreement.id,
      agreement.owner_id,
      tenant.user_id AS tenant_user_id,
      property.name AS property_name,
      agreement.end_date,
      agreement.end_date - p_today AS days_remaining
    FROM public.lease_agreements AS agreement
    JOIN public.tenants AS tenant ON tenant.id = agreement.tenant_id
    JOIN public.properties AS property ON property.id = agreement.property_id
    WHERE agreement.status = 'active'
      AND agreement.end_date - p_today IN (30, 7, 1, 0)
  ), agreement_recipients AS (
    SELECT
      agreement.id,
      agreement.owner_id AS user_id,
      agreement.property_name,
      agreement.end_date,
      agreement.days_remaining,
      '/agreements'::text AS href
    FROM expiring_agreements AS agreement
    UNION ALL
    SELECT
      agreement.id,
      agreement.tenant_user_id,
      agreement.property_name,
      agreement.end_date,
      agreement.days_remaining,
      '/cabinet'::text AS href
    FROM expiring_agreements AS agreement
    WHERE agreement.tenant_user_id IS NOT NULL
  )
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
  SELECT
    recipient.user_id,
    'agreement_expiring',
    CASE recipient.days_remaining
      WHEN 0 THEN 'Договор заканчивается сегодня'
      WHEN 1 THEN 'До окончания договора 1 день'
      ELSE 'Договор скоро закончится'
    END,
    left(
      'Объект «' || recipient.property_name || '»: договор действует до '
        || to_char(recipient.end_date, 'DD.MM.YYYY'),
      1000
    ),
    recipient.href,
    'agreement',
    recipient.id,
    'agreement_expiring:' || recipient.id::text || ':' || recipient.days_remaining::text
  FROM agreement_recipients AS recipient
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS batch_count = ROW_COUNT;
  inserted_count := inserted_count + batch_count;

  WITH upcoming_charges AS (
    SELECT
      charge.id,
      charge.owner_id,
      tenant.user_id AS tenant_user_id,
      property.name AS property_name,
      charge.due_date,
      charge.amount,
      charge.due_date - p_today AS days_remaining
    FROM public.rent_charges AS charge
    JOIN public.tenants AS tenant ON tenant.id = charge.tenant_id
    JOIN public.lease_agreements AS agreement ON agreement.id = charge.agreement_id
    JOIN public.properties AS property ON property.id = agreement.property_id
    WHERE charge.paid_at IS NULL
      AND charge.due_date - p_today IN (7, 3, 1, 0)
  ), payment_recipients AS (
    SELECT charge.*, charge.owner_id AS user_id
    FROM upcoming_charges AS charge
    UNION ALL
    SELECT charge.*, charge.tenant_user_id AS user_id
    FROM upcoming_charges AS charge
    WHERE charge.tenant_user_id IS NOT NULL
  )
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
  SELECT
    recipient.user_id,
    'payment_due',
    CASE recipient.days_remaining
      WHEN 0 THEN 'Срок оплаты сегодня'
      WHEN 1 THEN 'До оплаты остался 1 день'
      ELSE 'Приближается срок оплаты'
    END,
    left(
      'Объект «' || recipient.property_name || '»: ' || recipient.amount::text
        || ' ₽ до ' || to_char(recipient.due_date, 'DD.MM.YYYY'),
      1000
    ),
    '/payments',
    'rent_charge',
    recipient.id,
    'payment_due:' || recipient.id::text || ':' || recipient.days_remaining::text
  FROM payment_recipients AS recipient
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS batch_count = ROW_COUNT;
  inserted_count := inserted_count + batch_count;

  WITH overdue_charges AS (
    SELECT
      charge.id,
      charge.owner_id,
      tenant.user_id AS tenant_user_id,
      property.name AS property_name,
      charge.due_date,
      charge.amount,
      p_today - charge.due_date AS days_overdue
    FROM public.rent_charges AS charge
    JOIN public.tenants AS tenant ON tenant.id = charge.tenant_id
    JOIN public.lease_agreements AS agreement ON agreement.id = charge.agreement_id
    JOIN public.properties AS property ON property.id = agreement.property_id
    WHERE charge.paid_at IS NULL
      AND charge.due_date < p_today
  ), overdue_recipients AS (
    SELECT charge.*, charge.owner_id AS user_id
    FROM overdue_charges AS charge
    UNION ALL
    SELECT charge.*, charge.tenant_user_id AS user_id
    FROM overdue_charges AS charge
    WHERE charge.tenant_user_id IS NOT NULL
  )
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
  SELECT
    recipient.user_id,
    'payment_overdue',
    'Платёж просрочен',
    left(
      'Объект «' || recipient.property_name || '»: ' || recipient.amount::text
        || ' ₽, просрочка ' || recipient.days_overdue::text || ' дн.',
      1000
    ),
    '/payments',
    'rent_charge',
    recipient.id,
    'payment_overdue:' || recipient.id::text
  FROM overdue_recipients AS recipient
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS batch_count = ROW_COUNT;
  inserted_count := inserted_count + batch_count;

  RETURN inserted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.enqueue_rental_reminders(date)
  FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule(
  'rental-reminders-daily',
  '15 6 * * *',
  'SELECT private.enqueue_rental_reminders();'
);

SELECT private.enqueue_rental_reminders(CURRENT_DATE);
