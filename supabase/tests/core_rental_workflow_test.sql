BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(36);

-- Stable IDs keep the assertions readable. The enclosing transaction makes the
-- suite safe to run repeatedly: users and rental data are always rolled back.
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
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'owner@smart-rental.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Test Owner","role":"owner"}'::jsonb,
  now(),
  now()
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = '10000000-0000-0000-0000-000000000001'
      AND email = 'owner@smart-rental.invalid'
  ),
  'registration creates the owner profile'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = '10000000-0000-0000-0000-000000000001'
      AND role = 'owner'
  ),
  'registration assigns the owner role'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    INSERT INTO public.properties (id, owner_id, name, type, address)
    VALUES (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'Test Property',
      'apartment',
      'Test Address'
    )
  $$,
  'owner can create a property'
);

SELECT lives_ok(
  $$
    INSERT INTO public.units (id, property_id, name, area)
    VALUES (
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'Unit 1',
      42
    )
  $$,
  'owner can add a unit to their property'
);

SELECT lives_ok(
  $$
    INSERT INTO public.tenants (id, owner_id, name, email)
    VALUES (
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'Test Tenant',
      'tenant@smart-rental.invalid'
    )
  $$,
  'owner can create an invited tenant'
);

SELECT lives_ok(
  $$
    INSERT INTO public.lease_agreements (
      id,
      owner_id,
      property_id,
      unit_id,
      tenant_id,
      start_date,
      end_date,
      monthly_payment,
      payment_due_day,
      status,
      signed_document_file
    )
    VALUES (
      '50000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      CURRENT_DATE - 1,
      CURRENT_DATE + 60,
      50000,
      15,
      'active',
      '10000000-0000-0000-0000-000000000001/test-signed.pdf'
    )
  $$,
  'owner can create a valid agreement'
);

RESET ROLE;

SELECT cmp_ok(
  (
    SELECT count(*)
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000001'
  ),
  '>',
  0::bigint,
  'agreement creates the payment schedule'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000001'
      AND EXTRACT(DAY FROM due_date) <> 15
  ),
  'payment schedule follows the agreement due day'
);

-- Registering with the invited email must attach the existing tenant record.
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
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000002',
  'authenticated',
  'authenticated',
  'tenant@smart-rental.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Test Tenant","role":"tenant"}'::jsonb,
  now(),
  now()
);

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
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000003',
  'authenticated',
  'authenticated',
  'outsider@smart-rental.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Test Outsider","role":"tenant"}'::jsonb,
  now(),
  now()
);

SELECT results_eq(
  $$
    SELECT user_id
    FROM public.tenants
    WHERE id = '40000000-0000-0000-0000-000000000001'
  $$,
  ARRAY['10000000-0000-0000-0000-000000000002'::uuid],
  'tenant registration links the invitation by email'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = '10000000-0000-0000-0000-000000000002'
      AND role = 'tenant'
  ),
  'registration assigns the tenant role'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.properties$$,
  ARRAY[1::bigint],
  'tenant sees the property from their active agreement'
);

SELECT results_eq(
  $$SELECT count(*) FROM public.lease_agreements$$,
  ARRAY[1::bigint],
  'tenant sees their agreement'
);

SELECT lives_ok(
  $$
    INSERT INTO public.requests (
      id,
      tenant_id,
      owner_id,
      property_id,
      unit_id,
      title,
      description,
      category,
      status
    )
    VALUES (
      '60000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      'Test request',
      'The tap is leaking',
      'repair',
      'new'
    )
  $$,
  'tenant can create a request for an active agreement'
);

SELECT results_eq(
  $$SELECT count(*) FROM public.requests$$,
  ARRAY[1::bigint],
  'tenant sees their request'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.requests$$,
  ARRAY[1::bigint],
  'owner sees the new request'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comments (id, request_id, user_id, text)
    VALUES (
      '70000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'We will fix it tomorrow'
    )
  $$,
  'owner can comment on the request'
);

SELECT lives_ok(
  $$
    UPDATE public.requests
    SET status = 'closed'
    WHERE id = '60000000-0000-0000-0000-000000000001'
  $$,
  'owner can close the request'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$
    SELECT status::text
    FROM public.requests
    WHERE id = '60000000-0000-0000-0000-000000000001'
  $$,
  ARRAY['closed'::text],
  'tenant sees the closed request status'
);

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.comments
    WHERE request_id = '60000000-0000-0000-0000-000000000001'
  $$,
  ARRAY[1::bigint],
  'tenant sees the owner comment'
);

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.notifications
    WHERE user_id = '10000000-0000-0000-0000-000000000002'
      AND entity_id = '60000000-0000-0000-0000-000000000001'
  $$,
  ARRAY[2::bigint],
  'tenant receives comment and status notifications'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.properties$$,
  ARRAY[0::bigint],
  'unrelated tenant cannot see the property'
);

SELECT results_eq(
  $$SELECT count(*) FROM public.requests$$,
  ARRAY[0::bigint],
  'unrelated tenant cannot see the request'
);

SELECT is_empty(
  $$
    UPDATE public.requests
    SET status = 'in_progress'
    WHERE id = '60000000-0000-0000-0000-000000000001'
    RETURNING id
  $$,
  'unrelated tenant cannot update the request'
);

SELECT throws_ok(
  $$
    INSERT INTO public.comments (request_id, user_id, text)
    VALUES (
      '60000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003',
      'Unauthorized comment'
    )
  $$,
  '42501',
  NULL,
  'unrelated tenant cannot comment on the request'
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    INSERT INTO public.lease_agreements (
      id,
      owner_id,
      property_id,
      unit_id,
      tenant_id,
      start_date,
      end_date,
      monthly_payment
    )
    VALUES (
      '50000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      CURRENT_DATE + 90,
      CURRENT_DATE + 180,
      55000
    )
  $$,
  'new agreements start as drafts'
);

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
  $$,
  ARRAY[0::bigint],
  'draft agreements do not create payment charges'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.lease_agreements
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  ARRAY[0::bigint],
  'tenant cannot see a draft agreement'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    UPDATE public.lease_agreements
    SET status = 'pending_signature'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'owner can send a draft for signature'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.lease_agreements
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  ARRAY[1::bigint],
  'tenant sees an agreement sent for signature'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    UPDATE public.lease_agreements
    SET status = 'active'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  'Для активации договора загрузите подписанный PDF',
  'unsigned agreement cannot be activated'
);

SELECT lives_ok(
  $$
    UPDATE public.lease_agreements
    SET signed_document_file = '10000000-0000-0000-0000-000000000001/lifecycle-signed.pdf'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'owner can attach the signed PDF'
);

SELECT lives_ok(
  $$
    UPDATE public.lease_agreements
    SET status = 'active'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'signed agreement can be activated'
);

SELECT ok(
  (
    SELECT signed_at IS NOT NULL
    FROM public.lease_agreements
    WHERE id = '50000000-0000-0000-0000-000000000002'
  ),
  'signed PDF records its upload time'
);

SELECT cmp_ok(
  (
    SELECT count(*)
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
  ),
  '>',
  0::bigint,
  'activation creates the payment schedule'
);

RESET ROLE;

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.notifications
    WHERE entity_id = '50000000-0000-0000-0000-000000000002'
      AND kind = 'agreement_status'
      AND user_id IN (
        '10000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000002'
      )
  $$,
  ARRAY[4::bigint],
  'owner and tenant receive agreement status notifications'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'has_role',
        'is_my_tenant_record',
        'owns_property',
        'tenant_can_see_property',
        'can_see_request',
        'lease_relationship_is_valid',
        'tenant_can_create_request'
      )
  ),
  'RLS helper functions are not exposed in the public schema'
);

SELECT * FROM finish();
ROLLBACK;
