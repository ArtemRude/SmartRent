BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(12);

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '92000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'support-owner-one@smartrent.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Support Owner One","role":"owner"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '92000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'support-owner-two@smartrent.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Support Owner Two","role":"owner"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '92000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'support-admin@smartrent.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Support Admin","role":"admin"}'::jsonb,
    now(),
    now()
  );

UPDATE public.user_roles
SET role = 'admin'::public.app_role
WHERE user_id = '92000000-0000-0000-0000-000000000003';

SELECT ok(
  has_table_privilege('anon', 'public.support_requests', 'insert'),
  'anonymous users can create support requests'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.support_requests', 'select,update,delete'),
  'anonymous users cannot read, update, or delete support requests'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.support_requests', 'select,insert'),
  'authenticated users can create and read permitted support requests'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.support_requests', 'delete'),
  'authenticated users cannot delete support requests'
);

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

SELECT lives_ok(
  $$
    INSERT INTO public.support_requests (
      requester_name, requester_email, category, message, source
    ) VALUES (
      'Landing Visitor', 'visitor@example.com', 'question',
      'Please tell me more about SmartRent.', 'landing'
    )
  $$,
  'anonymous visitor can submit the landing form'
);

SELECT results_eq(
  $$SELECT count(*) FROM public.support_requests$$,
  ARRAY[0::bigint],
  'anonymous visitor cannot read submitted requests'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    INSERT INTO public.support_requests (
      user_id, requester_name, requester_email, category, message, source
    ) VALUES (
      '92000000-0000-0000-0000-000000000001', 'Support Owner One',
      'support-owner-one@smartrent.invalid', 'technical',
      'I need help with my account dashboard.', 'account'
    )
  $$,
  'authenticated user can submit an account request'
);

SELECT results_eq(
  $$SELECT count(*) FROM public.support_requests$$,
  ARRAY[1::bigint],
  'authenticated user reads only their own request'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.support_requests$$,
  ARRAY[0::bigint],
  'another authenticated user cannot read the request'
);

SELECT is_empty(
  $$
    UPDATE public.support_requests
    SET status = 'resolved', updated_at = now()
    RETURNING id
  $$,
  'non-admin user cannot update a support request'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.support_requests$$,
  ARRAY[2::bigint],
  'administrator can read all support requests'
);

SELECT lives_ok(
  $$
    UPDATE public.support_requests
    SET status = 'resolved', admin_response = 'We have resolved your request.', updated_at = now()
    WHERE user_id = '92000000-0000-0000-0000-000000000001'
  $$,
  'administrator can resolve and answer a support request'
);

SELECT * FROM finish();
ROLLBACK;
