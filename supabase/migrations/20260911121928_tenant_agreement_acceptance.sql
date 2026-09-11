SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.agreement_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL
    REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  agreement_version timestamptz NOT NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreement_acceptances_agreement_version_key
    UNIQUE (agreement_id, agreement_version)
);

ALTER TABLE public.agreement_acceptances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agreement_acceptances FROM anon, authenticated;
GRANT SELECT ON public.agreement_acceptances TO authenticated;
GRANT INSERT (agreement_id, agreement_version, accepted_by)
  ON public.agreement_acceptances TO authenticated;
GRANT ALL ON public.agreement_acceptances TO service_role;

CREATE POLICY agreement_acceptances_select_participants
  ON public.agreement_acceptances
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.lease_agreements AS agreement
      LEFT JOIN public.tenants AS tenant ON tenant.id = agreement.tenant_id
      WHERE agreement.id = agreement_acceptances.agreement_id
        AND (
          agreement.owner_id = (SELECT auth.uid())
          OR tenant.user_id = (SELECT auth.uid())
          OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
        )
    )
  );

CREATE POLICY agreement_acceptances_tenant_insert
  ON public.agreement_acceptances
  FOR INSERT
  TO authenticated
  WITH CHECK (
    accepted_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.lease_agreements AS agreement
      JOIN public.tenants AS tenant ON tenant.id = agreement.tenant_id
      WHERE agreement.id = agreement_acceptances.agreement_id
        AND tenant.user_id = (SELECT auth.uid())
        AND agreement.status = 'pending_signature'
        AND agreement.status_changed_at = agreement_acceptances.agreement_version
    )
  );

CREATE INDEX agreement_acceptances_accepted_by_idx
  ON public.agreement_acceptances(accepted_by)
  WHERE accepted_by IS NOT NULL;

CREATE OR REPLACE FUNCTION private.enforce_agreement_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' AND current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'Новый договор можно создать только как черновик'
        USING ERRCODE = '23514';
    END IF;

    NEW.status_changed_at := clock_timestamp();
    NEW.signed_at := CASE WHEN NEW.signed_document_file IS NULL THEN NULL ELSE now() END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status = 'pending_signature')
      OR (OLD.status = 'pending_signature' AND NEW.status = 'draft')
      OR (OLD.status = 'pending_signature' AND NEW.status = 'active')
      OR (OLD.status = 'active' AND NEW.status = 'completed')
    ) THEN
      RAISE EXCEPTION 'Недопустимый переход статуса договора: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'pending_signature'
      AND NEW.status = 'active'
      AND NEW.signed_document_file IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.agreement_acceptances AS acceptance
        WHERE acceptance.agreement_id = NEW.id
          AND acceptance.agreement_version = OLD.status_changed_at
      )
    THEN
      RAISE EXCEPTION 'Арендатор ещё не подтвердил условия договора'
        USING ERRCODE = '23514';
    END IF;

    NEW.status_changed_at := clock_timestamp();
  END IF;

  IF NEW.status = 'active' AND NEW.signed_document_file IS NULL THEN
    RAISE EXCEPTION 'Для активации договора загрузите подписанный PDF'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.signed_document_file IS DISTINCT FROM OLD.signed_document_file THEN
    NEW.signed_at := CASE WHEN NEW.signed_document_file IS NULL THEN NULL ELSE now() END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.enforce_agreement_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

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
      'payment_overdue'
    )
  ) NOT VALID;
ALTER TABLE public.notifications
  VALIDATE CONSTRAINT notifications_kind_valid;

CREATE OR REPLACE FUNCTION private.notify_agreement_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  agreement_owner_id uuid;
  property_name text;
BEGIN
  SELECT agreement.owner_id, property.name
  INTO agreement_owner_id, property_name
  FROM public.lease_agreements AS agreement
  JOIN public.properties AS property ON property.id = agreement.property_id
  WHERE agreement.id = NEW.agreement_id;

  INSERT INTO public.notifications (
    user_id,
    kind,
    title,
    body,
    href,
    entity_type,
    entity_id
  )
  VALUES (
    agreement_owner_id,
    'agreement_accepted',
    'Арендатор подтвердил договор',
    left('Объект «' || COALESCE(property_name, 'без названия') || '»', 1000),
    '/agreements',
    'agreement',
    NEW.agreement_id
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.notify_agreement_accepted()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS notification_agreement_accepted
  ON public.agreement_acceptances;
CREATE TRIGGER notification_agreement_accepted
  AFTER INSERT ON public.agreement_acceptances
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_agreement_accepted();
