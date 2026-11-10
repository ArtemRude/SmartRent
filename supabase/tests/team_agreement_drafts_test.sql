BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
  ('d8a10000-0000-0000-0000-000000000001', 'draft-owner@example.invalid', now(), '{"role":"owner"}'),
  ('d8a10000-0000-0000-0000-000000000002', 'draft-manager@example.invalid', now(), '{"role":"tenant"}'),
  ('d8a10000-0000-0000-0000-000000000003', 'draft-viewer@example.invalid', now(), '{"role":"owner"}'),
  ('d8a10000-0000-0000-0000-000000000004', 'draft-tenant@example.invalid', now(), '{"role":"tenant"}'),
  ('d8a10000-0000-0000-0000-000000000005', 'draft-outsider@example.invalid', now(), '{"role":"owner"}'),
  ('d8a10000-0000-0000-0000-000000000006', 'draft-peer@example.invalid', now(), '{"role":"owner"}');
INSERT INTO public.properties (id, owner_id, name, status) VALUES
  ('d8a20000-0000-0000-0000-000000000001', 'd8a10000-0000-0000-0000-000000000001', 'Shared property', 'active'),
  ('d8a20000-0000-0000-0000-000000000002', 'd8a10000-0000-0000-0000-000000000001', 'Unselected property', 'active'),
  ('d8a20000-0000-0000-0000-000000000003', 'd8a10000-0000-0000-0000-000000000005', 'Foreign property', 'active'),
  ('d8a20000-0000-0000-0000-000000000004', 'd8a10000-0000-0000-0000-000000000001', 'Archived property', 'archived');
INSERT INTO public.units (id, property_id, name) VALUES
  ('d8a40000-0000-0000-0000-000000000001', 'd8a20000-0000-0000-0000-000000000001', 'Selected unit'),
  ('d8a40000-0000-0000-0000-000000000002', 'd8a20000-0000-0000-0000-000000000002', 'Other unit');
INSERT INTO public.team_memberships (id, owner_id, user_id, email, role, status) VALUES
  ('d8a50000-0000-0000-0000-000000000001', 'd8a10000-0000-0000-0000-000000000001', 'd8a10000-0000-0000-0000-000000000002', 'draft-manager@example.invalid', 'manager', 'active'),
  ('d8a50000-0000-0000-0000-000000000002', 'd8a10000-0000-0000-0000-000000000001', 'd8a10000-0000-0000-0000-000000000003', 'draft-viewer@example.invalid', 'viewer', 'active'),
  ('d8a50000-0000-0000-0000-000000000003', 'd8a10000-0000-0000-0000-000000000001', 'd8a10000-0000-0000-0000-000000000006', 'draft-peer@example.invalid', 'manager', 'active');
INSERT INTO public.team_property_access (membership_id, property_id) VALUES
  ('d8a50000-0000-0000-0000-000000000001', 'd8a20000-0000-0000-0000-000000000001'),
  ('d8a50000-0000-0000-0000-000000000001', 'd8a20000-0000-0000-0000-000000000004'),
  ('d8a50000-0000-0000-0000-000000000002', 'd8a20000-0000-0000-0000-000000000001'),
  ('d8a50000-0000-0000-0000-000000000003', 'd8a20000-0000-0000-0000-000000000001');
INSERT INTO public.tenants (id, owner_id, name, email, phone) VALUES
  ('d8a30000-0000-0000-0000-000000000001', 'd8a10000-0000-0000-0000-000000000002', 'Manager contact', '  DRAFT-TENANT@example.invalid ', 'MANAGER_PHONE_PRIVATE'),
  ('d8a30000-0000-0000-0000-000000000002', 'd8a10000-0000-0000-0000-000000000001', 'OWNER_CONTACT_PRIVATE', 'draft-tenant@example.invalid', 'OWNER_PHONE_PRIVATE'),
  ('d8a30000-0000-0000-0000-000000000003', 'd8a10000-0000-0000-0000-000000000002', 'New contact', ' COPIED@example.invalid ', 'DO_NOT_COPY_PHONE'),
  ('d8a30000-0000-0000-0000-000000000004', 'd8a10000-0000-0000-0000-000000000002', 'Duplicate contact', 'duplicate@example.invalid', NULL),
  ('d8a30000-0000-0000-0000-000000000005', 'd8a10000-0000-0000-0000-000000000001', 'Owner duplicate A', 'duplicate@example.invalid', NULL),
  ('d8a30000-0000-0000-0000-000000000006', 'd8a10000-0000-0000-0000-000000000001', 'Owner duplicate B', ' DUPLICATE@example.invalid ', NULL),
  ('d8a30000-0000-0000-0000-000000000007', 'd8a10000-0000-0000-0000-000000000002', 'Manager contact without email', '', NULL),
  ('d8a30000-0000-0000-0000-000000000008', 'd8a10000-0000-0000-0000-000000000001', 'Owner contact without email', '', NULL),
  ('d8a30000-0000-0000-0000-000000000009', 'd8a10000-0000-0000-0000-000000000006', 'Peer contact', 'draft-tenant@example.invalid', NULL);

CREATE FUNCTION pg_temp.create_draft(
  draft uuid, tenant uuid, property uuid DEFAULT 'd8a20000-0000-0000-0000-000000000001',
  unit uuid DEFAULT NULL, start_on date DEFAULT '2027-01-01', end_on date DEFAULT '2027-06-01',
  rent numeric DEFAULT 40000, due_day integer DEFAULT NULL
) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.create_team_agreement_draft(property, tenant, draft, start_on, end_on, rent, unit, due_day);
$$;

SELECT ok(NOT has_function_privilege('anon', 'public.create_team_agreement_draft(uuid,uuid,uuid,date,date,numeric,uuid,integer)', 'EXECUTE'), 'anonymous callers cannot execute the draft RPC');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.create_team_agreement_draft(uuid,uuid,uuid,date,date,numeric,uuid,integer)'::regprocedure), false, 'public wrapper uses invoker rights');

SELECT set_config('request.jwt.claims', '{"sub":"d8a10000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.create_draft('d8a60000-0000-0000-0000-000000000001', 'd8a30000-0000-0000-0000-000000000001', unit => 'd8a40000-0000-0000-0000-000000000001', due_day => 12), 'd8a60000-0000-0000-0000-000000000001'::uuid, 'scoped manager can prepare a draft for the owner');
SELECT is(pg_temp.create_draft('d8a60000-0000-0000-0000-000000000001', 'd8a30000-0000-0000-0000-000000000001', unit => 'd8a40000-0000-0000-0000-000000000001', due_day => 12), 'd8a60000-0000-0000-0000-000000000001'::uuid, 'an identical retry returns the first draft ID');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000001', 'd8a30000-0000-0000-0000-000000000001', unit => 'd8a40000-0000-0000-0000-000000000001', rent => 90000, due_day => 12)$$, '22023', 'Черновик уже создан или изменён. Проверьте его условия в разделе «Договоры».', 'changed terms on the same request ID are reported as a conflict');
SELECT is(pg_temp.create_draft('d8a60000-0000-0000-0000-000000000002', 'd8a30000-0000-0000-0000-000000000003'), 'd8a60000-0000-0000-0000-000000000002'::uuid, 'manager can prepare a draft for a new owner contact');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000001', 'd8a30000-0000-0000-0000-000000000003')$$, '22023', NULL, 'a draft ID cannot be reused with another contact');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000002')$$, '42501', NULL, 'manager cannot supply an owner contact ID');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', 'd8a20000-0000-0000-0000-000000000002')$$, '42501', NULL, 'same-owner property outside the grant is denied');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', 'd8a20000-0000-0000-0000-000000000003')$$, '42501', NULL, 'another owner property is denied');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', 'd8a20000-0000-0000-0000-000000000004')$$, '22023', NULL, 'a manager cannot draft against an archived property');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', unit => 'd8a40000-0000-0000-0000-000000000002')$$, '22023', NULL, 'foreign unit is rejected');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000004')$$, '22023', NULL, 'ambiguous normalized email is rejected');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000007')$$, '22023', NULL, 'an email is required to reuse or copy a contact');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', end_on => '2026-12-31')$$, '22023', NULL, 'reversed dates are rejected');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', end_on => 'infinity')$$, '22023', NULL, 'infinite dates are rejected');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', rent => 'NaN')$$, '22023', NULL, 'nonfinite rent is rejected');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', rent => -1)$$, '22023', NULL, 'negative rent is rejected');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001', due_day => 32)$$, '22023', NULL, 'invalid payment day is rejected');
SELECT is((SELECT count(*) FROM public.tenants WHERE owner_id = 'd8a10000-0000-0000-0000-000000000001'), 0::bigint, 'manager cannot read the owner roster');
SELECT is((SELECT count(*) FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000001'), 0::bigint, 'manager cannot read the raw owner draft');
SELECT ok(public.team_workspace('d8a20000-0000-0000-0000-000000000001')::text NOT LIKE '%OWNER_CONTACT_PRIVATE%', 'manager cannot reveal a matching owner contact through the shared workspace');
SELECT is(jsonb_array_length(public.team_workspace('d8a20000-0000-0000-0000-000000000001')->'agreements'), 0, 'manager-created drafts are private to owner before signing');
SELECT is(jsonb_array_length(public.property_hub('d8a20000-0000-0000-0000-000000000001') #> '{workspace,agreements}'), 0, 'nested property workspace also protects the draft');
WITH changed AS (UPDATE public.lease_agreements SET monthly_payment = 1, status = 'pending_signature' WHERE id = 'd8a60000-0000-0000-0000-000000000001' RETURNING id)
SELECT is((SELECT count(*) FROM changed), 0::bigint, 'manager cannot edit or send the draft for signing');
WITH deleted AS (DELETE FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000001' RETURNING id)
SELECT is((SELECT count(*) FROM deleted), 0::bigint, 'manager cannot delete the owner draft');
RESET ROLE;

SELECT is((SELECT count(*) FROM public.lease_agreements WHERE owner_id = 'd8a10000-0000-0000-0000-000000000001'), 2::bigint, 'only the two valid draft requests inserted agreements');
SELECT is((SELECT tenant_id FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000001'), 'd8a30000-0000-0000-0000-000000000002'::uuid, 'owner contact reused by normalized email');
SELECT is((SELECT phone FROM public.tenants WHERE id = 'd8a30000-0000-0000-0000-000000000002'), 'OWNER_PHONE_PRIVATE', 'reusing the contact does not overwrite owner contact fields');
SELECT ok(EXISTS (SELECT 1 FROM public.tenants t JOIN public.lease_agreements a ON a.tenant_id = t.id WHERE a.id = 'd8a60000-0000-0000-0000-000000000002' AND t.name = 'New contact' AND t.email = 'copied@example.invalid' AND t.phone IS NULL), 'only name and normalized email are copied into the owner roster');
SELECT ok(EXISTS (SELECT 1 FROM public.lease_agreements a WHERE a.id = 'd8a60000-0000-0000-0000-000000000001' AND a.status = 'draft' AND a.monthly_payment = 40000 AND a.payment_due_day = 12 AND a.unit_id = 'd8a40000-0000-0000-0000-000000000001' AND a.document_file IS NULL AND a.signed_document_file IS NULL AND a.signed_at IS NULL), 'only original draft terms were stored without documents');
SELECT is((SELECT count(*) FROM public.agreement_status_events WHERE agreement_id = 'd8a60000-0000-0000-0000-000000000001'), 1::bigint, 'retry did not duplicate draft audit');
SELECT is((SELECT changed_by FROM public.agreement_status_events WHERE agreement_id = 'd8a60000-0000-0000-0000-000000000001' AND from_status IS NULL AND to_status = 'draft'), 'd8a10000-0000-0000-0000-000000000002'::uuid, 'initial draft audit credits actual manager');
SELECT is((SELECT team_prepared FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000001'), true, 'manager-created agreement is marked as a team handoff');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE agreement_id IN ('d8a60000-0000-0000-0000-000000000001', 'd8a60000-0000-0000-0000-000000000002')), 0::bigint, 'drafts do not create rent charges');
SELECT is((SELECT count(*) FROM public.notifications WHERE entity_id IN ('d8a60000-0000-0000-0000-000000000001', 'd8a60000-0000-0000-0000-000000000002')), 0::bigint, 'drafts do not send agreement notifications');

SELECT set_config('request.jwt.claims', '{"sub":"d8a10000-0000-0000-0000-000000000006","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000001', 'd8a30000-0000-0000-0000-000000000009')$$, '22023', NULL, 'a second scoped manager cannot claim the original actor’s draft ID');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"d8a10000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001')$$, '42501', NULL, 'viewer cannot prepare an agreement');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"d8a10000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000001')$$, '42501', NULL, 'outsider cannot prepare a shared-property agreement');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"d8a10000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000001'), 0::bigint, 'linked tenant cannot see the draft');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d8a10000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000008', rent => 0), 'd8a60000-0000-0000-0000-000000000003'::uuid, 'owner can create a draft for an existing contact with no email');
SELECT is((SELECT tenant_id FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000003'), 'd8a30000-0000-0000-0000-000000000008'::uuid, 'owner flow uses the selected tenant directly');
SELECT is((SELECT team_prepared FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000003'), false, 'owner-created agreement is not marked as a team handoff');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000003', 'd8a30000-0000-0000-0000-000000000008', 'd8a20000-0000-0000-0000-000000000002')$$, '22023', NULL, 'owner cannot reuse a draft ID on another property');
SELECT is(jsonb_array_length(public.team_workspace('d8a20000-0000-0000-0000-000000000001')->'agreements'), 3, 'owner can see both handoff drafts and the owner draft in the workspace');
WITH changed AS (UPDATE public.lease_agreements SET monthly_payment = 50000 WHERE id = 'd8a60000-0000-0000-0000-000000000002' RETURNING id)
SELECT is((SELECT count(*) FROM changed), 1::bigint, 'owner can edit a handoff draft');
WITH changed AS (UPDATE public.lease_agreements SET status = 'pending_signature' WHERE id = 'd8a60000-0000-0000-0000-000000000001' RETURNING id)
SELECT is((SELECT count(*) FROM changed), 1::bigint, 'owner can send a handoff draft for signing');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d8a10000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.create_draft('d8a60000-0000-0000-0000-000000000001', 'd8a30000-0000-0000-0000-000000000001', unit => 'd8a40000-0000-0000-0000-000000000001', due_day => 12), 'd8a60000-0000-0000-0000-000000000001'::uuid, 'identical retry after owner handoff returns the existing agreement');
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000002', 'd8a30000-0000-0000-0000-000000000003')$$, '22023', NULL, 'retry conflicts after owner changed the stored terms');
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000001' AND status = 'pending_signature'), 'retry leaves owner status intact');
SELECT is((SELECT monthly_payment FROM public.lease_agreements WHERE id = 'd8a60000-0000-0000-0000-000000000002'), 50000::numeric, 'retry leaves edited owner terms intact');

-- Keep the property grant to verify that the current membership, not just the grant, is required.
UPDATE public.team_memberships SET status = 'revoked' WHERE id = 'd8a50000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT pg_temp.create_draft('d8a60000-0000-0000-0000-000000000001', 'd8a30000-0000-0000-0000-000000000001')$$, '42501', NULL, 'revoked manager cannot retry or prepare a draft even with an old grant');
RESET ROLE;

-- Auth account deletion clears changed_by without removing the owner’s agreement.
UPDATE public.agreement_status_events SET changed_by = NULL WHERE agreement_id = 'd8a60000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claims', '{"sub":"d8a10000-0000-0000-0000-000000000006","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.team_workspace('d8a20000-0000-0000-0000-000000000001')->'agreements') a WHERE a->>'id' = 'd8a60000-0000-0000-0000-000000000002'), 'team draft stays private when its audit actor is cleared');
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(public.team_workspace('d8a20000-0000-0000-0000-000000000001')->'agreements') a WHERE a->>'id' = 'd8a60000-0000-0000-0000-000000000003'), 'legacy owner draft summary stays visible to the team');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
