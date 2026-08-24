CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_kind_valid CHECK (
    kind IN (
      'request_created',
      'request_comment',
      'request_status',
      'agreement_created',
      'payment_status'
    )
  ),
  CONSTRAINT notifications_entity_type_valid CHECK (
    entity_type IN ('request', 'agreement', 'rent_charge')
  ),
  CONSTRAINT notifications_title_length CHECK (char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT notifications_body_length CHECK (char_length(body) <= 1000),
  CONSTRAINT notifications_href_valid CHECK (
    char_length(href) BETWEEN 1 AND 200 AND left(href, 1) = '/'
  ),
  CONSTRAINT notifications_read_after_creation CHECK (
    read_at IS NULL OR read_at >= created_at
  )
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO service_role;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION private.notify_request_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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
    'request_created',
    'Новая заявка',
    left(NEW.title, 1000),
    '/requests',
    'request',
    NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.notify_request_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_owner_id uuid;
  tenant_user_id uuid;
  request_title text;
BEGIN
  SELECT request.owner_id, tenant.user_id, request.title
  INTO request_owner_id, tenant_user_id, request_title
  FROM public.requests AS request
  JOIN public.tenants AS tenant ON tenant.id = request.tenant_id
  WHERE request.id = NEW.request_id;

  IF request_owner_id IS NOT NULL AND request_owner_id <> NEW.user_id THEN
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
      request_owner_id,
      'request_comment',
      'Новый комментарий',
      left(COALESCE(NULLIF(NEW.text, ''), request_title), 1000),
      '/requests',
      'request',
      NEW.request_id
    );
  END IF;

  IF tenant_user_id IS NOT NULL
    AND tenant_user_id <> NEW.user_id
    AND tenant_user_id IS DISTINCT FROM request_owner_id
  THEN
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
      'request_comment',
      'Новый комментарий',
      left(COALESCE(NULLIF(NEW.text, ''), request_title), 1000),
      '/requests',
      'request',
      NEW.request_id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.notify_request_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tenant_user_id uuid;
  status_label text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT tenant.user_id
  INTO tenant_user_id
  FROM public.tenants AS tenant
  WHERE tenant.id = NEW.tenant_id;

  status_label := CASE NEW.status
    WHEN 'new' THEN 'Новая'
    WHEN 'in_progress' THEN 'В работе'
    WHEN 'closed' THEN 'Закрыта'
    ELSE NEW.status::text
  END;

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
      'request_status',
      'Статус заявки изменён',
      left(NEW.title || ': ' || status_label, 1000),
      '/requests',
      'request',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION private.notify_payment_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tenant_user_id uuid;
BEGIN
  IF NEW.paid_at IS NOT DISTINCT FROM OLD.paid_at THEN
    RETURN NEW;
  END IF;

  SELECT tenant.user_id
  INTO tenant_user_id
  FROM public.tenants AS tenant
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
      'payment_status',
      CASE WHEN NEW.paid_at IS NULL THEN 'Отметка об оплате снята' ELSE 'Оплата отмечена' END,
      'Платёж со сроком до ' || to_char(NEW.due_date, 'DD.MM.YYYY'),
      '/payments',
      'rent_charge',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.notify_request_created()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.notify_request_comment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.notify_request_status_changed()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.notify_agreement_created()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.notify_payment_status_changed()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS notification_request_created ON public.requests;
CREATE TRIGGER notification_request_created
  AFTER INSERT ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_request_created();

DROP TRIGGER IF EXISTS notification_request_comment ON public.comments;
CREATE TRIGGER notification_request_comment
  AFTER INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_request_comment();

DROP TRIGGER IF EXISTS notification_request_status_changed ON public.requests;
CREATE TRIGGER notification_request_status_changed
  AFTER UPDATE OF status ON public.requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.notify_request_status_changed();

DROP TRIGGER IF EXISTS notification_agreement_created ON public.lease_agreements;
CREATE TRIGGER notification_agreement_created
  AFTER INSERT ON public.lease_agreements
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_agreement_created();

DROP TRIGGER IF EXISTS notification_payment_status_changed ON public.rent_charges;
CREATE TRIGGER notification_payment_status_changed
  AFTER UPDATE OF paid_at ON public.rent_charges
  FOR EACH ROW
  WHEN (OLD.paid_at IS DISTINCT FROM NEW.paid_at)
  EXECUTE FUNCTION private.notify_payment_status_changed();
