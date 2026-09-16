BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(76);

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

RESET ROLE;

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
  'trusted seed can create an existing active agreement'
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

SELECT results_eq(
  $$SELECT count(*) FROM public.agreement_status_events$$,
  ARRAY[0::bigint],
  'unrelated tenant cannot see agreement status history'
);

SELECT throws_ok(
  $$
    INSERT INTO public.agreement_acceptances (
      agreement_id,
      agreement_version,
      accepted_by
    )
    VALUES (
      '50000000-0000-0000-0000-000000000001',
      now(),
      '10000000-0000-0000-0000-000000000003'
    )
  $$,
  '42501',
  NULL,
  'unrelated tenant cannot accept an agreement'
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

SELECT throws_ok(
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
      status,
      signed_document_file
    )
    VALUES (
      '50000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      CURRENT_DATE + 200,
      CURRENT_DATE + 260,
      60000,
      'active',
      '10000000-0000-0000-0000-000000000001/direct-active.pdf'
    )
  $$,
  '23514',
  'Новый договор можно создать только как черновик',
  'owner cannot bypass the draft and acceptance workflow'
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

SELECT throws_ok(
  $$
    UPDATE public.lease_agreements
    SET status = 'active'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  'Арендатор ещё не подтвердил условия договора',
  'agreement cannot be activated before tenant acceptance'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    INSERT INTO public.agreement_acceptances (
      agreement_id,
      agreement_version,
      accepted_by
    )
    SELECT
      id,
      status_changed_at,
      '10000000-0000-0000-0000-000000000002'
    FROM public.lease_agreements
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'tenant can confirm the current agreement version'
);

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.agreement_acceptances
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
  $$,
  ARRAY[1::bigint],
  'tenant sees their agreement acceptance'
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
    SET status = 'draft'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'owner can return the accepted agreement to draft'
);

SELECT lives_ok(
  $$
    UPDATE public.lease_agreements
    SET status = 'pending_signature'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'owner can send a revised agreement for confirmation'
);

SELECT throws_ok(
  $$
    UPDATE public.lease_agreements
    SET status = 'active'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  'Арендатор ещё не подтвердил условия договора',
  'an earlier acceptance cannot activate a revised agreement'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    INSERT INTO public.agreement_acceptances (
      agreement_id,
      agreement_version,
      accepted_by
    )
    SELECT
      id,
      status_changed_at,
      '10000000-0000-0000-0000-000000000002'
    FROM public.lease_agreements
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'tenant can confirm the revised agreement version'
);

SELECT throws_ok(
  $$
    DELETE FROM public.agreement_acceptances
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
  $$,
  '42501',
  NULL,
  'clients cannot delete agreement acceptances'
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
    SET status = 'active'
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'signed agreement can be activated'
);

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.agreement_acceptances
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
  $$,
  ARRAY[2::bigint],
  'owner sees the tenant acceptance'
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

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.agreement_status_events
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
  $$,
  ARRAY[5::bigint],
  'owner sees every agreement lifecycle event'
);

SELECT throws_ok(
  $$
    INSERT INTO public.agreement_status_events (
      agreement_id,
      from_status,
      to_status,
      changed_by
    )
    VALUES (
      '50000000-0000-0000-0000-000000000002',
      'active',
      'completed',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  '42501',
  NULL,
  'clients cannot forge agreement lifecycle events'
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
    FROM public.agreement_status_events
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
  $$,
  ARRAY[5::bigint],
  'tenant sees lifecycle history after the agreement is shared'
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
    UPDATE public.rent_charges
    SET
      adjustment_amount = 2500,
      adjustment_reason = 'Индексация коммунальных услуг'
    WHERE id = (
      SELECT id
      FROM public.rent_charges
      WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
      ORDER BY period_start
      LIMIT 1
    )
  $$,
  'owner can adjust an unpaid charge with a reason'
);

SELECT results_eq(
  $$
    SELECT amount + adjustment_amount
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    ORDER BY period_start
    LIMIT 1
  $$,
  ARRAY[57500::numeric],
  'adjustment changes the effective charge total'
);

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.rent_charge_adjustment_events
  $$,
  ARRAY[1::bigint],
  'adjustment is recorded in immutable history'
);

SELECT lives_ok(
  $$
    UPDATE public.lease_agreements
    SET payment_due_day = 20
    WHERE id = '50000000-0000-0000-0000-000000000002'
  $$,
  'billing schedule can be recalculated after an adjustment'
);

SELECT results_eq(
  $$
    SELECT adjustment_amount
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    ORDER BY period_start
    LIMIT 1
  $$,
  ARRAY[2500::numeric],
  'schedule recalculation preserves the manual adjustment'
);

SELECT throws_ok(
  $$
    UPDATE public.rent_charges
    SET adjustment_amount = 3000
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
      AND adjustment_amount = 2500
  $$,
  '23514',
  'adjustment reason is required',
  'every amount change requires a new reason'
);

SELECT throws_ok(
  $$
    UPDATE public.rent_charges
    SET
      adjustment_amount = -60000,
      adjustment_reason = 'Некорректное списание'
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
      AND adjustment_amount = 2500
  $$,
  '23514',
  NULL,
  'an adjustment cannot make the total negative'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.rent_charge_adjustment_events$$,
  ARRAY[1::bigint],
  'tenant sees adjustment history for their charge'
);

SELECT is_empty(
  $$
    UPDATE public.rent_charges
    SET
      adjustment_amount = 5000,
      adjustment_reason = 'Несанкционированная корректировка'
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    RETURNING id
  $$,
  'tenant cannot adjust a charge'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.rent_charge_adjustment_events$$,
  ARRAY[0::bigint],
  'unrelated user cannot see adjustment history'
);

SELECT throws_ok(
  $$
    INSERT INTO public.rent_charge_adjustment_events (
      charge_id,
      previous_adjustment_amount,
      adjustment_amount,
      reason
    )
    SELECT id, 0, 1000, 'Поддельная запись'
    FROM public.rent_charges
    LIMIT 1
  $$,
  '42501',
  NULL,
  'clients cannot forge adjustment history'
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
  ARRAY[8::bigint],
  'owner and tenant receive agreement status notifications'
);

SELECT results_eq(
  $$
    SELECT count(*)
    FROM public.notifications
    WHERE entity_id = '50000000-0000-0000-0000-000000000002'
      AND kind = 'agreement_accepted'
      AND user_id = '10000000-0000-0000-0000-000000000001'
  $$,
  ARRAY[2::bigint],
  'owner receives a tenant acceptance notification'
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

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    INSERT INTO public.rent_payments (
      id, charge_id, owner_id, tenant_id, amount, paid_at, note, receipt_file
    )
    SELECT
      '90000000-0000-0000-0000-000000000001',
      id,
      owner_id,
      tenant_id,
      10000,
      now(),
      'Частичная оплата',
      '10000000-0000-0000-0000-000000000001/test-receipt.pdf'
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    ORDER BY period_start
    LIMIT 1
  $$,
  'owner can record a partial rent payment'
);

SELECT results_eq(
  $$
    SELECT paid_amount
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    ORDER BY period_start
    LIMIT 1
  $$,
  ARRAY[10000::numeric],
  'partial payment updates the paid amount'
);

SELECT throws_ok(
  $$
    INSERT INTO public.rent_payments (
      charge_id, owner_id, tenant_id, amount, paid_at, receipt_file
    )
    SELECT
      id,
      owner_id,
      tenant_id,
      1000,
      now(),
      '10000000-0000-0000-0000-000000000002/foreign-receipt.pdf'
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    ORDER BY period_start
    OFFSET 1
    LIMIT 1
  $$,
  '23514',
  'receipt must be uploaded to the current user folder',
  'owner cannot attach a receipt from another user folder'
);

SELECT throws_ok(
  $$
    UPDATE public.rent_payments
    SET amount = 100000
    WHERE id = '90000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  'payment exceeds remaining charge balance',
  'a payment cannot exceed the charge balance'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.rent_payments$$,
  ARRAY[1::bigint],
  'tenant can see payment history for their lease'
);

SELECT results_eq(
  $$SELECT receipt_file FROM public.rent_payments$$,
  ARRAY['10000000-0000-0000-0000-000000000001/test-receipt.pdf'::text],
  'tenant can see the receipt attached to their payment'
);

SELECT throws_ok(
  $$
    INSERT INTO public.rent_payments (
      charge_id, owner_id, tenant_id, amount, paid_at
    )
    SELECT id, owner_id, tenant_id, 1000, now()
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    ORDER BY period_start
    LIMIT 1
  $$,
  '42501',
  NULL,
  'tenant cannot record a payment'
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
    INSERT INTO public.rent_payments (
      id, charge_id, owner_id, tenant_id, amount, paid_at
    )
    SELECT
      '90000000-0000-0000-0000-000000000002',
      id,
      owner_id,
      tenant_id,
      47500,
      now()
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    ORDER BY period_start
    LIMIT 1
  $$,
  'owner can complete a charge with a second payment'
);

SELECT results_eq(
  $$
    WITH removed AS (
      DELETE FROM public.rent_payments
      WHERE id = '90000000-0000-0000-0000-000000000002'
    )
    SELECT paid_amount
    FROM public.rent_charges
    WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
    ORDER BY period_start
    LIMIT 1
  $$,
  ARRAY[10000::numeric],
  'owner can remove a mistaken payment and reopen the balance'
);

RESET ROLE;
UPDATE public.rent_charges
SET due_date = CURRENT_DATE - 1
WHERE id = (
  SELECT id
  FROM public.rent_charges
  WHERE agreement_id = '50000000-0000-0000-0000-000000000002'
  ORDER BY period_start
  LIMIT 1
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT public.send_payment_reminder('50000000-0000-0000-0000-000000000002')$$,
  ARRAY['sent'::text],
  'owner can remind a connected tenant about overdue rent'
);

SELECT results_eq(
  $$SELECT public.send_payment_reminder('50000000-0000-0000-0000-000000000002')$$,
  ARRAY['already_sent'::text],
  'only one manual reminder is sent per agreement each day'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$SELECT count(*) FROM public.notifications WHERE kind = 'payment_reminder'$$,
  ARRAY[1::bigint],
  'tenant sees the manual payment reminder'
);

SELECT throws_ok(
  $$SELECT public.send_payment_reminder('50000000-0000-0000-0000-000000000002')$$,
  '42501',
  'Agreement is unavailable',
  'tenant cannot send a payment reminder'
);

SELECT * FROM finish();
ROLLBACK;
