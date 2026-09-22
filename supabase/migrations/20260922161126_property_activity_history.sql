SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.property_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL
    REFERENCES public.properties(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_activity_event_type_known CHECK (
    event_type IN (
      'property_created',
      'property_updated',
      'unit_created',
      'unit_updated',
      'unit_deleted'
    )
  ),
  CONSTRAINT property_activity_entity_type_known CHECK (
    entity_type IN ('property', 'unit')
  ),
  CONSTRAINT property_activity_details_object CHECK (
    jsonb_typeof(details) = 'object'
  )
);

COMMENT ON TABLE public.property_activity_events IS
  'Append-only audit events for changes made directly to properties and units.';

CREATE INDEX property_activity_events_property_created_idx
  ON public.property_activity_events(property_id, created_at DESC, id DESC);
CREATE INDEX property_activity_events_actor_idx
  ON public.property_activity_events(actor_id)
  WHERE actor_id IS NOT NULL;

ALTER TABLE public.property_activity_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.property_activity_events FROM anon, authenticated;
GRANT SELECT ON public.property_activity_events TO authenticated;
GRANT ALL ON public.property_activity_events TO service_role;

CREATE POLICY property_activity_events_owner_select
  ON public.property_activity_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.properties AS property
      WHERE property.id = property_id
        AND property.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY property_activity_events_admin_select
  ON public.property_activity_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  );

INSERT INTO public.property_activity_events (
  property_id,
  actor_id,
  event_type,
  entity_type,
  entity_id,
  title,
  details,
  created_at
)
SELECT
  property.id,
  NULL,
  'property_created',
  'property',
  property.id,
  'Объект создан',
  jsonb_build_object('name', property.name),
  property.created_at
FROM public.properties AS property;

INSERT INTO public.property_activity_events (
  property_id,
  actor_id,
  event_type,
  entity_type,
  entity_id,
  title,
  details,
  created_at
)
SELECT
  unit.property_id,
  NULL,
  'unit_created',
  'unit',
  unit.id,
  'Добавлено помещение',
  jsonb_build_object('name', unit.name),
  unit.created_at
FROM public.units AS unit;

CREATE OR REPLACE FUNCTION private.record_property_activity_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed_fields text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.property_activity_events (
      property_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      title,
      details
    )
    VALUES (
      NEW.id,
      (SELECT auth.uid()),
      'property_created',
      'property',
      NEW.id,
      'Объект создан',
      jsonb_build_object('name', NEW.name)
    );
  ELSE
    changed_fields := array_remove(
      ARRAY[
        CASE WHEN NEW.name IS DISTINCT FROM OLD.name THEN 'Название' END,
        CASE WHEN NEW.address IS DISTINCT FROM OLD.address THEN 'Адрес' END,
        CASE WHEN NEW.type IS DISTINCT FROM OLD.type THEN 'Тип' END,
        CASE WHEN NEW.description IS DISTINCT FROM OLD.description THEN 'Описание' END,
        CASE WHEN NEW.photos IS DISTINCT FROM OLD.photos THEN 'Фотографии' END,
        CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'Статус' END
      ]::text[],
      NULL
    );

    IF cardinality(changed_fields) > 0 THEN
      INSERT INTO public.property_activity_events (
        property_id,
        actor_id,
        event_type,
        entity_type,
        entity_id,
        title,
        details
      )
      VALUES (
        NEW.id,
        (SELECT auth.uid()),
        'property_updated',
        'property',
        NEW.id,
        'Параметры объекта изменены',
        jsonb_build_object('fields', to_jsonb(changed_fields))
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.record_property_activity_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER property_activity_event_audit
  AFTER INSERT OR UPDATE OF name, address, type, description, photos, status
  ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION private.record_property_activity_event();

CREATE OR REPLACE FUNCTION private.record_unit_activity_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed_fields text[];
  target_property_id uuid;
  target_entity_id uuid;
  target_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_property_id := OLD.property_id;
    target_entity_id := OLD.id;
    target_name := OLD.name;
  ELSE
    target_property_id := NEW.property_id;
    target_entity_id := NEW.id;
    target_name := NEW.name;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.property_activity_events (
      property_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      title,
      details
    )
    VALUES (
      target_property_id,
      (SELECT auth.uid()),
      'unit_created',
      'unit',
      target_entity_id,
      'Добавлено помещение',
      jsonb_build_object('name', target_name)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.property_activity_events (
      property_id,
      actor_id,
      event_type,
      entity_type,
      entity_id,
      title,
      details
    )
    VALUES (
      target_property_id,
      (SELECT auth.uid()),
      'unit_deleted',
      'unit',
      target_entity_id,
      'Удалено помещение',
      jsonb_build_object('name', target_name)
    );
  ELSE
    changed_fields := array_remove(
      ARRAY[
        CASE WHEN NEW.name IS DISTINCT FROM OLD.name THEN 'Название' END,
        CASE WHEN NEW.area IS DISTINCT FROM OLD.area THEN 'Площадь' END,
        CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'Статус' END
      ]::text[],
      NULL
    );

    IF cardinality(changed_fields) > 0 THEN
      INSERT INTO public.property_activity_events (
        property_id,
        actor_id,
        event_type,
        entity_type,
        entity_id,
        title,
        details
      )
      VALUES (
        target_property_id,
        (SELECT auth.uid()),
        'unit_updated',
        'unit',
        target_entity_id,
        'Параметры помещения изменены',
        jsonb_build_object(
          'name', target_name,
          'fields', to_jsonb(changed_fields)
        )
      );
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.record_unit_activity_event()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER unit_activity_event_audit
  AFTER INSERT OR UPDATE OF name, area, status OR DELETE
  ON public.units
  FOR EACH ROW
  EXECUTE FUNCTION private.record_unit_activity_event();
