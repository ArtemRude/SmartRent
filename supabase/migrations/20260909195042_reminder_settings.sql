SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.reminder_settings (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  notify_owner boolean NOT NULL DEFAULT true,
  notify_tenant boolean NOT NULL DEFAULT true,
  payment_due_enabled boolean NOT NULL DEFAULT true,
  payment_overdue_enabled boolean NOT NULL DEFAULT true,
  agreement_expiring_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reminder_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.reminder_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_settings TO service_role;

CREATE POLICY reminder_settings_select_own_or_admin
  ON public.reminder_settings
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  );

CREATE POLICY reminder_settings_insert_own
  ON public.reminder_settings
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY reminder_settings_update_own
  ON public.reminder_settings
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION private.filter_rental_reminder_by_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  reminder_owner_id uuid;
  settings public.reminder_settings%ROWTYPE;
BEGIN
  IF NEW.kind NOT IN ('agreement_expiring', 'payment_due', 'payment_overdue') THEN
    RETURN NEW;
  END IF;

  IF NEW.entity_type = 'agreement' THEN
    SELECT agreement.owner_id
    INTO reminder_owner_id
    FROM public.lease_agreements AS agreement
    WHERE agreement.id = NEW.entity_id;
  ELSIF NEW.entity_type = 'rent_charge' THEN
    SELECT charge.owner_id
    INTO reminder_owner_id
    FROM public.rent_charges AS charge
    WHERE charge.id = NEW.entity_id;
  END IF;

  IF reminder_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT owner_settings.*
  INTO settings
  FROM public.reminder_settings AS owner_settings
  WHERE owner_settings.owner_id = reminder_owner_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NOT settings.enabled
    OR (NEW.user_id = reminder_owner_id AND NOT settings.notify_owner)
    OR (NEW.user_id <> reminder_owner_id AND NOT settings.notify_tenant)
    OR (NEW.kind = 'payment_due' AND NOT settings.payment_due_enabled)
    OR (NEW.kind = 'payment_overdue' AND NOT settings.payment_overdue_enabled)
    OR (NEW.kind = 'agreement_expiring' AND NOT settings.agreement_expiring_enabled)
  THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION private.filter_rental_reminder_by_settings()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS filter_rental_reminder_by_settings ON public.notifications;
CREATE TRIGGER filter_rental_reminder_by_settings
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.kind IN ('agreement_expiring', 'payment_due', 'payment_overdue'))
  EXECUTE FUNCTION private.filter_rental_reminder_by_settings();
