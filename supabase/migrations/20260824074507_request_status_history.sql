CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE public.request_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  from_status public.request_status,
  to_status public.request_status NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT request_status_event_is_change
    CHECK (from_status IS NULL OR from_status <> to_status)
);

ALTER TABLE public.request_status_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.request_status_events FROM anon, authenticated;
GRANT SELECT ON public.request_status_events TO authenticated;
GRANT ALL ON public.request_status_events TO service_role;

CREATE POLICY "request_status_events_select_participants"
  ON public.request_status_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.can_see_request(request_id))
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'))
  );

CREATE INDEX request_status_events_request_created_idx
  ON public.request_status_events(request_id, created_at);
CREATE INDEX request_status_events_changed_by_idx
  ON public.request_status_events(changed_by)
  WHERE changed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS comments_request_created_idx
  ON public.comments(request_id, created_at);
CREATE INDEX IF NOT EXISTS comments_user_id_idx
  ON public.comments(user_id);

-- Give existing requests a starting point in the timeline. Future entries are
-- recorded by the trigger below.
INSERT INTO public.request_status_events (
  request_id,
  from_status,
  to_status,
  changed_by,
  created_at
)
SELECT id, NULL, status, NULL, created_at
FROM public.requests;

CREATE OR REPLACE FUNCTION private.record_request_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.request_status_events (
      request_id,
      from_status,
      to_status,
      changed_by
    )
    VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      NEW.status,
      (SELECT auth.uid())
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.record_request_status_event()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS request_status_event_audit ON public.requests;
CREATE TRIGGER request_status_event_audit
  AFTER INSERT OR UPDATE OF status ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION private.record_request_status_event();
