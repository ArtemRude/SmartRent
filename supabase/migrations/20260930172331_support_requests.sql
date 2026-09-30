SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_name text NOT NULL,
  requester_email text NOT NULL,
  category text NOT NULL,
  message text NOT NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  admin_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_requests_name_length
    CHECK (char_length(btrim(requester_name)) BETWEEN 2 AND 120),
  CONSTRAINT support_requests_email_format
    CHECK (char_length(btrim(requester_email)) BETWEEN 3 AND 254 AND requester_email LIKE '%@%'),
  CONSTRAINT support_requests_category_valid
    CHECK (category IN ('question', 'access', 'billing', 'technical', 'other')),
  CONSTRAINT support_requests_message_length
    CHECK (char_length(btrim(message)) BETWEEN 10 AND 4000),
  CONSTRAINT support_requests_source_valid
    CHECK (source IN ('landing', 'account')),
  CONSTRAINT support_requests_status_valid
    CHECK (status IN ('new', 'in_progress', 'resolved')),
  CONSTRAINT support_requests_response_length
    CHECK (admin_response IS NULL OR char_length(admin_response) <= 4000)
);

CREATE INDEX support_requests_user_id_idx
  ON public.support_requests (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX support_requests_open_created_at_idx
  ON public.support_requests (created_at DESC)
  WHERE status IN ('new', 'in_progress');

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.support_requests FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.support_requests TO anon;
GRANT SELECT, INSERT ON TABLE public.support_requests TO authenticated;
GRANT UPDATE (status, admin_response, updated_at) ON TABLE public.support_requests TO authenticated;
GRANT ALL ON TABLE public.support_requests TO service_role;

CREATE POLICY support_requests_anon_insert
  ON public.support_requests
  FOR INSERT
  TO anon
  WITH CHECK (
    (SELECT auth.uid()) IS NULL
    AND user_id IS NULL
    AND source = 'landing'
    AND status = 'new'
    AND admin_response IS NULL
  );

CREATE POLICY support_requests_authenticated_insert
  ON public.support_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND source IN ('landing', 'account')
    AND status = 'new'
    AND admin_response IS NULL
  );

CREATE POLICY support_requests_select_own
  ON public.support_requests
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY support_requests_admin_select
  ON public.support_requests
  FOR SELECT
  TO authenticated
  USING ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

CREATE POLICY support_requests_admin_update
  ON public.support_requests
  FOR UPDATE
  TO authenticated
  USING ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

COMMENT ON TABLE public.support_requests IS
  'Support messages submitted from the public landing page or an authenticated account.';
