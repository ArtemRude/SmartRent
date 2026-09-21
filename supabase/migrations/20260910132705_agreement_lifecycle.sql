SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.lease_agreements
  ADD COLUMN IF NOT EXISTS signed_document_file text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.lease_agreements
  ALTER COLUMN status SET DEFAULT 'draft',
  DROP CONSTRAINT IF EXISTS lease_status_is_known;

UPDATE public.lease_agreements
SET
  status = 'completed',
  status_changed_at = now()
WHERE status = 'archived';

ALTER TABLE public.lease_agreements
  ADD CONSTRAINT lease_status_is_known CHECK (
    status IN ('draft', 'pending_signature', 'active', 'completed')
  ) NOT VALID;

ALTER TABLE public.lease_agreements
  VALIDATE CONSTRAINT lease_status_is_known;

ALTER TABLE public.lease_agreements
  ADD CONSTRAINT lease_signed_timestamp_requires_file CHECK (
    signed_at IS NULL OR signed_document_file IS NOT NULL
  ) NOT VALID;

ALTER TABLE public.lease_agreements
  VALIDATE CONSTRAINT lease_signed_timestamp_requires_file;

CREATE OR REPLACE FUNCTION private.enforce_agreement_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := COALESCE(NEW.status_changed_at, now());
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

    NEW.status_changed_at := now();
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

DROP TRIGGER IF EXISTS enforce_agreement_lifecycle_on_insert
  ON public.lease_agreements;
CREATE TRIGGER enforce_agreement_lifecycle_on_insert
  BEFORE INSERT ON public.lease_agreements
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_agreement_lifecycle();

DROP TRIGGER IF EXISTS enforce_agreement_lifecycle_on_update
  ON public.lease_agreements;
CREATE TRIGGER enforce_agreement_lifecycle_on_update
  BEFORE UPDATE OF status, signed_document_file ON public.lease_agreements
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_agreement_lifecycle();

ALTER POLICY leases_tenant_select ON public.lease_agreements
  USING (
    private.is_my_tenant_record(tenant_id)
    AND status IN ('pending_signature', 'active', 'completed')
  );

CREATE OR REPLACE FUNCTION private.tenant_can_see_property(_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.lease_agreements AS la
    JOIN public.tenants AS t ON t.id = la.tenant_id
    WHERE la.property_id = _property_id
      AND t.user_id = (SELECT auth.uid())
      AND (
        la.status IN ('pending_signature', 'completed')
        OR (
          la.status = 'active'
          AND CURRENT_DATE BETWEEN la.start_date AND la.end_date
        )
      )
  );
$function$;

REVOKE EXECUTE ON FUNCTION private.tenant_can_see_property(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.tenant_can_see_property(uuid)
  TO authenticated, service_role;

ALTER POLICY lease_documents_select_authorized ON storage.objects
  USING (
    bucket_id = 'lease-documents'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR EXISTS (
        SELECT 1
        FROM public.lease_agreements AS la
        WHERE (
            la.document_file = objects.name
            OR la.signed_document_file = objects.name
          )
          AND (
            la.owner_id = (SELECT auth.uid())
            OR private.is_my_tenant_record(la.tenant_id)
          )
      )
    )
  );

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
      'agreement_expiring',
      'payment_status',
      'payment_due',
      'payment_overdue'
    )
  ) NOT VALID;
ALTER TABLE public.notifications
  VALIDATE CONSTRAINT notifications_kind_valid;

CREATE OR REPLACE FUNCTION private.notify_agreement_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tenant_user_id uuid;
  property_name text;
BEGIN
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  SELECT tenant.user_id, property.name
  INTO tenant_user_id, property_name
  FROM public.tenants AS tenant
  JOIN public.properties AS property ON property.id = NEW.property_id
  WHERE tenant.id = NEW.tenant_id;

  IF tenant_user_id IS NOT NULL AND tenant_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
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
      tenant_user_id,
      'agreement_created',
      'Добавлен договор аренды',
      left('Объект: ' || COALESCE(property_name, 'без названия'), 1000),
      '/cabinet',
      'agreement',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.notify_agreement_created()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.notify_agreement_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tenant_user_id uuid;
  property_name text;
  status_label text;
BEGIN
  SELECT tenant.user_id, property.name
  INTO tenant_user_id, property_name
  FROM public.tenants AS tenant
  JOIN public.properties AS property ON property.id = NEW.property_id
  WHERE tenant.id = NEW.tenant_id;

  status_label := CASE NEW.status
    WHEN 'draft' THEN 'Черновик'
    WHEN 'pending_signature' THEN 'На подписании'
    WHEN 'active' THEN 'Активен'
    WHEN 'completed' THEN 'Завершён'
    ELSE NEW.status
  END;

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
    NEW.owner_id,
    'agreement_status',
    'Статус договора изменён',
    left('Объект «' || COALESCE(property_name, 'без названия') || '»: ' || status_label, 1000),
    '/agreements',
    'agreement',
    NEW.id
  );

  IF tenant_user_id IS NOT NULL AND tenant_user_id IS DISTINCT FROM NEW.owner_id THEN
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
      tenant_user_id,
      'agreement_status',
      'Статус договора изменён',
      left('Объект «' || COALESCE(property_name, 'без названия') || '»: ' || status_label, 1000),
      '/cabinet',
      'agreement',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.notify_agreement_status_changed()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS notification_agreement_status_changed
  ON public.lease_agreements;
CREATE TRIGGER notification_agreement_status_changed
  AFTER UPDATE OF status ON public.lease_agreements
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.notify_agreement_status_changed();
