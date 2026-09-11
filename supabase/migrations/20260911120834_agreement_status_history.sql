SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.agreement_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL
    REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agreement_status_events_from_status_known CHECK (
    from_status IS NULL
    OR from_status IN ('draft', 'pending_signature', 'active', 'completed')
  ),
  CONSTRAINT agreement_status_events_to_status_known CHECK (
    to_status IN ('draft', 'pending_signature', 'active', 'completed')
  ),
  CONSTRAINT agreement_status_event_is_change CHECK (
    from_status IS NULL OR from_status <> to_status
  )
);

ALTER TABLE public.agreement_status_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agreement_status_events FROM anon, authenticated;
GRANT SELECT ON public.agreement_status_events TO authenticated;
GRANT ALL ON public.agreement_status_events TO service_role;

CREATE POLICY agreement_status_events_owner_select
  ON public.agreement_status_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.lease_agreements AS agreement
      WHERE agreement.id = agreement_id
        AND agreement.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY agreement_status_events_tenant_select
  ON public.agreement_status_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.lease_agreements AS agreement
      JOIN public.tenants AS tenant ON tenant.id = agreement.tenant_id
      WHERE agreement.id = agreement_id
        AND tenant.user_id = (SELECT auth.uid())
        AND agreement.status IN ('pending_signature', 'active', 'completed')
    )
  );

CREATE POLICY agreement_status_events_admin_select
  ON public.agreement_status_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  );

CREATE INDEX agreement_status_events_agreement_created_idx
  ON public.agreement_status_events(agreement_id, created_at);
CREATE INDEX agreement_status_events_changed_by_idx
  ON public.agreement_status_events(changed_by)
  WHERE changed_by IS NOT NULL;

-- Existing agreements receive one initial event. Future changes are captured by
-- the trigger below, so clients only receive read access to this audit trail.
INSERT INTO public.agreement_status_events (
  agreement_id,
  from_status,
  to_status,
  changed_by,
  created_at
)
SELECT
  id,
  NULL,
  status,
  NULL,
  COALESCE(status_changed_at, created_at)
FROM public.lease_agreements;

CREATE OR REPLACE FUNCTION private.record_agreement_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.agreement_status_events (
      agreement_id,
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

REVOKE EXECUTE ON FUNCTION private.record_agreement_status_event()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS agreement_status_event_audit
  ON public.lease_agreements;
CREATE TRIGGER agreement_status_event_audit
  AFTER INSERT OR UPDATE OF status ON public.lease_agreements
  FOR EACH ROW
  EXECUTE FUNCTION private.record_agreement_status_event();
