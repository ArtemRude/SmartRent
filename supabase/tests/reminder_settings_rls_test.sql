BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(6);

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
    '91000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'reminder-owner-one@smart-rental.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Reminder Owner One","role":"owner"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'reminder-owner-two@smart-rental.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Reminder Owner Two","role":"owner"}'::jsonb,
    now(),
    now()
  );

SELECT ok(
  NOT has_table_privilege('anon', 'public.reminder_settings', 'select,insert,update,delete'),
  'anonymous users have no reminder settings privileges'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.reminder_settings', 'delete'),
  'authenticated users cannot delete reminder settings'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    INSERT INTO public.reminder_settings (owner_id, notify_tenant)
    VALUES ('91000000-0000-0000-0000-000000000001', false)
  $$,
  'owner can create their reminder settings'
);

SELECT lives_ok(
  $$
    UPDATE public.reminder_settings
    SET payment_overdue_enabled = false
    WHERE owner_id = '91000000-0000-0000-0000-000000000001'
  $$,
  'owner can update their reminder settings'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.reminder_settings$$,
  ARRAY[0::bigint],
  'another owner cannot read reminder settings'
);

SELECT is_empty(
  $$
    UPDATE public.reminder_settings
    SET enabled = false
    WHERE owner_id = '91000000-0000-0000-0000-000000000001'
    RETURNING owner_id
  $$,
  'another owner cannot update reminder settings'
);

SELECT * FROM finish();
ROLLBACK;
