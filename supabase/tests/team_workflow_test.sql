BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- Every identity, invitation and rental row is discarded by the final rollback.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'team-owner-a@example.invalid', now(), '{"name":"Owner A","role":"owner"}'),
  ('d1000000-0000-0000-0000-000000000002', 'team-owner-b@example.invalid', now(), '{"name":"Owner B","role":"owner"}'),
  ('d1000000-0000-0000-0000-000000000003', 'team-manager@example.invalid', now(), '{"name":"Manager","role":"tenant"}'),
  ('d1000000-0000-0000-0000-000000000004', 'team-viewer@example.invalid', now(), '{"name":"Viewer","role":"owner"}'),
  ('d1000000-0000-0000-0000-000000000005', 'team-tenant@example.invalid', now(), '{"name":"Tenant","role":"tenant"}'),
  ('d1000000-0000-0000-0000-000000000006', 'team-admin@example.invalid', now(), '{"name":"Admin","role":"owner"}'),
  ('d1000000-0000-0000-0000-000000000007', 'team-unconfirmed@example.invalid', NULL, '{"name":"Unconfirmed","role":"owner"}'),
  ('d1000000-0000-0000-0000-000000000008', 'team-attacker@example.invalid', now(), '{"name":"Attacker","role":"admin","email":"team-manager@example.invalid"}'),
  ('d1000000-0000-0000-0000-000000000009', 'private-manager-peer@example.invalid', now(), '{"name":"","role":"owner"}'),
  ('d1000000-0000-0000-0000-000000000010', 'private-manager-unselected@example.invalid', now(), '{"name":"Unselected manager","role":"owner"}'),
  ('d1000000-0000-0000-0000-000000000011', 'private-manager-other-owner@example.invalid', now(), '{"name":"Foreign manager","role":"owner"}');
UPDATE public.user_roles SET role = 'admin'
WHERE user_id = 'd1000000-0000-0000-0000-000000000006';
-- The profile can be edited by its user; invitation acceptance must ignore it.
UPDATE public.profiles SET email = 'team-manager@example.invalid'
WHERE id = 'd1000000-0000-0000-0000-000000000008';

INSERT INTO public.properties (id, owner_id, name, address, description) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Selected apartment', 'Selected address', 'Description for team'),
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'Unselected apartment', 'Unselected address', 'UNSELECTED_PROPERTY_SECRET'),
  ('d2000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000002', 'Other owner apartment', 'Other address', 'OTHER_OWNER_PROPERTY_SECRET'),
  ('d2000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', 'Transfer apartment', 'Transfer address', NULL);
INSERT INTO public.team_memberships (id, owner_id, user_id, email, role, status) VALUES
  ('d7000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000009', 'private-manager-peer@example.invalid', 'manager', 'active'),
  ('d7000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000010', 'private-manager-unselected@example.invalid', 'manager', 'active'),
  ('d7000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000011', 'private-manager-other-owner@example.invalid', 'manager', 'active'),
  ('d7000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', NULL, 'private-deleted-manager@example.invalid', 'manager', 'active');
INSERT INTO public.team_property_access (membership_id, property_id) VALUES
  ('d7000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001'),
  ('d7000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002'),
  ('d7000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000003'),
  ('d7000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000001');
INSERT INTO public.units (id, property_id, name, area) VALUES
  ('d2100000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'Selected unit', 42),
  ('d2100000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'UNSELECTED_UNIT_SECRET', 38);
INSERT INTO public.tenants (id, owner_id, user_id, name, email, phone) VALUES
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', 'Linked tenant', 'PRIVATE_TENANT_EMAIL@example.invalid', 'PRIVATE_TENANT_PHONE'),
  ('d3000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', NULL, 'Other tenant', 'OTHER_TENANT_EMAIL@example.invalid', NULL);
INSERT INTO public.lease_agreements (
  id, owner_id, property_id, unit_id, tenant_id, start_date, end_date,
  monthly_payment, status, contract_details, document_file, signed_document_file
) VALUES
  ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd2100000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', CURRENT_DATE - 10, CURRENT_DATE + 180, 60000, 'active', '{"passport":"PRIVATE_PASSPORT_SECRET"}', 'PRIVATE_ORIGINAL_FILE.pdf', 'PRIVATE_SIGNED_FILE.pdf'),
  ('d4000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'd2100000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000001', CURRENT_DATE - 10, CURRENT_DATE + 180, 40000, 'active', '{}', NULL, 'UNSELECTED_SIGNED_FILE.pdf'),
  ('d4000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000003', NULL, 'd3000000-0000-0000-0000-000000000002', CURRENT_DATE - 10, CURRENT_DATE + 180, 50000, 'active', '{}', NULL, 'OTHER_OWNER_SIGNED_FILE.pdf');
INSERT INTO public.requests (id, owner_id, property_id, tenant_id, title, description, category) VALUES
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'Leaking tap', 'Visible team request', 'repair'),
  ('d5000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-000000000001', 'UNSELECTED_REQUEST_SECRET', 'Not selected', 'repair'),
  ('d5000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000002', 'OTHER_OWNER_REQUEST_SECRET', 'Other owner', 'repair');
INSERT INTO public.comments (request_id, user_id, text) VALUES
  ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', 'Tenant comment for team'),
  ('d5000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000005', 'UNSELECTED_COMMENT_SECRET');

CREATE FUNCTION pg_temp.team_invite_id(setting_name text)
RETURNS uuid LANGUAGE sql AS $$
  SELECT (current_setting(setting_name)::jsonb ->> 'membership_id')::uuid;
$$;
CREATE FUNCTION pg_temp.team_invite_token(setting_name text)
RETURNS text LANGUAGE sql AS $$
  SELECT current_setting(setting_name)::jsonb ->> 'token';
$$;

SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
  'public.team_memberships'::regclass, 'public.team_property_access'::regclass,
  'public.team_property_responsibles'::regclass, 'public.team_activity'::regclass
)), 'all exposed team tables have RLS');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM (VALUES ('team_memberships'), ('team_property_access'),
    ('team_property_responsibles'), ('team_activity')) AS t(name)
  WHERE has_table_privilege('authenticated', 'public.' || name, 'SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('anon', 'public.' || name, 'SELECT,INSERT,UPDATE,DELETE')
), 'team tables are RPC-only for both browser roles');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'invite_team_member', 'accept_team_invitation', 'manage_team_member',
    'set_team_responsible', 'act_on_team_property', 'team_overview', 'team_workspace'
  ) AND p.prosecdef
), 'public RPC wrappers use invoker rights');

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.team_memberships$$, '42501', NULL, 'owner cannot read hashes through the table');
SELECT throws_ok($$SELECT public.invite_team_member('team-owner-a@example.invalid', 'manager', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[])$$, '22023', NULL, 'self invitation rejected');
SELECT throws_ok($$SELECT public.invite_team_member('team-manager@example.invalid', 'admin', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[])$$, '22023', NULL, 'global administrator is not a team role');
SELECT throws_ok($$SELECT public.invite_team_member('team-manager@example.invalid', 'manager', '{}'::uuid[])$$, '22023', NULL, 'invitation needs selected properties');
SELECT throws_ok($$SELECT public.invite_team_member('not-an-email', 'manager', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[])$$, '22023', NULL, 'invalid email rejected');
SELECT throws_ok($$SELECT public.invite_team_member('team-manager@example.invalid', 'manager', ARRAY['d2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000003']::uuid[])$$, '42501', NULL, 'one foreign property rejects the whole invitation');
SELECT set_config('test.team_manager_old', public.invite_team_member(
  ' TEAM-MANAGER@example.invalid ', 'manager', ARRAY[
    'd2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004'
  ]::uuid[]
)::text, true);
SELECT ok(length(pg_temp.team_invite_token('test.team_manager_old')) >= 32, 'invitation returns a high-entropy token');
SELECT ok((current_setting('test.team_manager_old')::jsonb ->> 'expires_at')::timestamptz BETWEEN now() + interval '6 days' AND now() + interval '8 days', 'invitation expires in seven days');
SELECT set_config('test.team_manager', public.invite_team_member(
  'team-manager@example.invalid', 'manager', ARRAY[
    'd2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004'
  ]::uuid[]
)::text, true);
SELECT is(pg_temp.team_invite_id('test.team_manager'), pg_temp.team_invite_id('test.team_manager_old'), 'reissue keeps the pending membership identity');
SELECT ok(pg_temp.team_invite_token('test.team_manager') <> pg_temp.team_invite_token('test.team_manager_old'), 'reissue rotates the token');
SELECT set_config('test.team_viewer', public.invite_team_member(
  'team-viewer@example.invalid', 'viewer', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[]
)::text, true);
SELECT set_config('test.team_unconfirmed', public.invite_team_member(
  'team-unconfirmed@example.invalid', 'viewer', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[]
)::text, true);
SELECT ok(public.team_overview()::text NOT LIKE '%' || pg_temp.team_invite_token('test.team_manager') || '%', 'overview never returns plaintext invitation tokens');
SELECT ok(public.team_overview()::text NOT LIKE '%token_hash%', 'overview does not expose hash fields');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', pg_temp.team_invite_id('test.team_manager'))$$, '22023', NULL, 'pending invite cannot be responsible');
RESET ROLE;
SELECT is((SELECT email FROM public.team_memberships WHERE id = pg_temp.team_invite_id('test.team_manager')), 'team-manager@example.invalid', 'email is normalized on the server');
SELECT is((SELECT revision FROM public.team_memberships WHERE id = pg_temp.team_invite_id('test.team_manager')), 2, 'reissue increments optimistic revision');
SELECT ok((SELECT token_hash IS NOT NULL AND token_hash <> pg_temp.team_invite_token('test.team_manager') FROM public.team_memberships WHERE id = pg_temp.team_invite_id('test.team_manager')), 'only a hash is stored');

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000008","role":"authenticated","email":"team-manager@example.invalid","user_metadata":{"role":"admin","email":"team-manager@example.invalid"}}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_team_invitation(pg_temp.team_invite_token('test.team_manager'))$$, '42501', NULL, 'editable profile and forged JWT metadata do not prove invited email');
SELECT throws_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000001')$$, '42501', NULL, 'guessed workspace ID remains private');
SELECT is(jsonb_array_length(public.team_overview() -> 'workspaces'), 0, 'unrelated user overview contains no owner workspaces');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_team_invitation(pg_temp.team_invite_token('test.team_unconfirmed'))$$, '42501', NULL, 'matching but unconfirmed auth email cannot accept');
RESET ROLE;
UPDATE public.team_memberships SET expires_at = now() - interval '1 second'
WHERE id = pg_temp.team_invite_id('test.team_unconfirmed');
UPDATE auth.users SET email_confirmed_at = now()
WHERE id = 'd1000000-0000-0000-0000-000000000007';
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_team_invitation(pg_temp.team_invite_token('test.team_unconfirmed'))$$, '42501', NULL, 'expired token cannot be used even after email confirmation');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_team_invitation(pg_temp.team_invite_token('test.team_manager_old'))$$, '42501', NULL, 'old token invalid after reissue');
SELECT is(public.accept_team_invitation(pg_temp.team_invite_token('test.team_manager')), pg_temp.team_invite_id('test.team_manager'), 'matching confirmed identity accepts rotated invitation');
SELECT throws_ok($$SELECT public.accept_team_invitation(pg_temp.team_invite_token('test.team_manager'))$$, '42501', NULL, 'invitation token can be consumed only once');
SELECT is((SELECT role::text FROM public.user_roles WHERE user_id = 'd1000000-0000-0000-0000-000000000003'), 'tenant', 'team membership does not change account role');
SELECT is(jsonb_array_length(public.team_overview() -> 'workspaces'), 2, 'manager sees precisely selected workspaces');
SELECT ok(public.team_overview()::text NOT LIKE '%UNSELECTED_PROPERTY_SECRET%' AND public.team_overview()::text NOT LIKE '%OTHER_OWNER_PROPERTY_SECRET%', 'overview excludes unselected and other owner data');
SELECT set_config('test.team_workspace', public.team_workspace('d2000000-0000-0000-0000-000000000001')::text, true);
SELECT ok(current_setting('test.team_workspace') LIKE '%Leaking tap%' AND current_setting('test.team_workspace') LIKE '%Tenant comment for team%', 'selected workspace includes request discussion');
SELECT ok(current_setting('test.team_workspace') LIKE '%Selected unit%' AND current_setting('test.team_workspace') LIKE '%Linked tenant%', 'selected workspace includes basic units and lease names');
SELECT ok(current_setting('test.team_workspace') NOT LIKE '%PRIVATE_PASSPORT_SECRET%' AND current_setting('test.team_workspace') NOT LIKE '%PRIVATE_ORIGINAL_FILE%' AND current_setting('test.team_workspace') NOT LIKE '%PRIVATE_SIGNED_FILE%' AND current_setting('test.team_workspace') NOT LIKE '%PRIVATE_TENANT_EMAIL%' AND current_setting('test.team_workspace') NOT LIKE '%PRIVATE_TENANT_PHONE%', 'workspace omits contract details, document paths and tenant contact data');
SELECT ok(current_setting('test.team_workspace') NOT LIKE '%UNSELECTED_%' AND current_setting('test.team_workspace') NOT LIKE '%OTHER_OWNER_%', 'workspace nested lists stay within selected property');
SELECT throws_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000002')$$, '42501', NULL, 'same owner unselected property is denied');
SELECT throws_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000003')$$, '42501', NULL, 'other owner property is denied');
SELECT is((SELECT count(*) FROM public.lease_agreements), 0::bigint, 'membership does not grant raw lease access');
SELECT is((SELECT count(*) FROM public.tenants), 0::bigint, 'membership does not grant raw tenant access');
SELECT is((SELECT count(*) FROM public.rent_charges), 0::bigint, 'membership does not grant payment ledger access');
SELECT is((SELECT count(*) FROM public.property_expenses), 0::bigint, 'membership does not grant expense access');
SELECT throws_ok($$UPDATE public.team_memberships SET role = 'manager'$$, '42501', NULL, 'member cannot self-promote through table');
SELECT throws_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 3, 'manager', ARRAY['d2000000-0000-0000-0000-000000000002']::uuid[], false)$$, '42501', NULL, 'manager cannot enlarge their scope');
SELECT is(current_setting('test.team_workspace')::jsonb #>> '{responsible_assignment,membership_id}', NULL::text, 'unassigned property shows responsibility with the owner');
SELECT is(jsonb_array_length(current_setting('test.team_workspace')::jsonb #> '{responsible_assignment,candidates}'), 2, 'assignment candidates only include active managers with access to this property and a user account');
SELECT ok(current_setting('test.team_workspace')::jsonb #> '{responsible_assignment,candidates}' @> jsonb_build_array(
  jsonb_build_object('id', pg_temp.team_invite_id('test.team_manager'), 'name', 'Manager'),
  jsonb_build_object('id', 'd7000000-0000-0000-0000-000000000001', 'name', 'Управляющий')
), 'candidate selector only discloses the scoped membership ID and display name');
SELECT ok(current_setting('test.team_workspace') NOT LIKE '%private-manager-%', 'workspace does not expose contact information about eligible or other managers');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000002', NULL)$$, '42501', NULL, 'manager cannot assign responsibility for an unselected property');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000003', NULL)$$, '42501', NULL, 'manager cannot assign responsibility for another owner');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000002')$$, '22023', NULL, 'assignee must have access to the property');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000003')$$, '22023', NULL, 'assignee must belong to the same owner');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000004')$$, '22023', NULL, 'deleted assignee account cannot be selected');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', pg_temp.team_invite_id('test.team_manager'))$$, 'manager can take responsibility for a selected property');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', pg_temp.team_invite_id('test.team_manager'))$$, 'repeating the same assignment succeeds');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000001')$$, 'manager can reassign responsibility to another scoped manager');
SELECT is(public.team_workspace('d2000000-0000-0000-0000-000000000001') #>> '{responsible_assignment,membership_id}', 'd7000000-0000-0000-0000-000000000001', 'manager sees the updated assignment');
SELECT is(public.team_workspace('d2000000-0000-0000-0000-000000000001') #>> '{property,responsible_name}', 'Управляющий', 'selected nameless manager gets a generic label');
SELECT ok(public.team_overview()::text NOT LIKE '%private-manager-peer@example.invalid%', 'manager cannot use reassignment to read a peer email in the overview');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', NULL)$$, 'manager can return responsibility to the owner');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', NULL)$$, 'repeating the return to owner succeeds');
SELECT is(public.team_workspace('d2000000-0000-0000-0000-000000000001') #>> '{responsible_assignment,membership_id}', NULL::text, 'manager sees the default owner assignment after reset');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000002', 'note', '{"text":"Forbidden"}')$$, '42501', NULL, 'manager cannot write unselected workspace');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_status', '{"request_id":"d5000000-0000-0000-0000-000000000002","status":"closed","expected_status":"new"}')$$, '42501', NULL, 'request ID must belong to supplied selected property');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_comment', '{"request_id":"d5000000-0000-0000-0000-000000000003","text":"Forbidden"}')$$, '42501', NULL, 'cannot comment on another owner request');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'delete_property', '{}')$$, '22023', NULL, 'unknown action rejected');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'note', '{"text":"  "}')$$, '22023', NULL, 'blank notes rejected');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'note', jsonb_build_object('text', repeat('x', 2001)))$$, '22023', NULL, 'oversized note rejected');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_comment', jsonb_build_object('request_id', 'd5000000-0000-0000-0000-000000000001', 'text', repeat('x', 4001)))$$, '22023', NULL, 'oversized comment rejected');
SELECT lives_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'note', '{"text":"Manager inspected the tap","owner_id":"d1000000-0000-0000-0000-000000000002","actor_id":"d1000000-0000-0000-0000-000000000001"}')$$, 'manager can add property note while owner and actor are server derived');
SELECT lives_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_status', '{"request_id":"d5000000-0000-0000-0000-000000000001","status":"in_progress","expected_status":"new"}')$$, 'manager moves selected request to in progress');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_status', '{"request_id":"d5000000-0000-0000-0000-000000000001","status":"closed","expected_status":"new"}')$$, '40001', NULL, 'stale status update cannot overwrite current request');
SELECT lives_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_comment', '{"request_id":"d5000000-0000-0000-0000-000000000001","text":"Manager discussion reply","user_id":"d1000000-0000-0000-0000-000000000001"}')$$, 'manager comments on selected request');
SELECT throws_ok($$DELETE FROM public.team_activity$$, '42501', NULL, 'manager cannot erase team activity');
RESET ROLE;
SELECT set_config('test.team_comment_id', (SELECT id::text FROM public.comments WHERE request_id = 'd5000000-0000-0000-0000-000000000001' AND text = 'Manager discussion reply'), true);
SELECT is((SELECT count(*) FROM public.team_activity WHERE property_id = 'd2000000-0000-0000-0000-000000000001' AND action = 'responsible_changed'), 3::bigint, 'unchanged assignments do not duplicate audit events');
SELECT is((SELECT count(*) FROM public.team_activity WHERE property_id = 'd2000000-0000-0000-0000-000000000001' AND action = 'responsible_changed' AND owner_id = 'd1000000-0000-0000-0000-000000000001' AND actor_id = 'd1000000-0000-0000-0000-000000000003'), 3::bigint, 'assignment audit is attached to the owner team and credits the real manager');
SELECT is((SELECT count(*) FROM public.notifications WHERE entity_id = 'd2000000-0000-0000-0000-000000000001' AND user_id = 'd1000000-0000-0000-0000-000000000001' AND title = 'Изменён ответственный по объекту'), 3::bigint, 'the owner receives a notification per real manager assignment change');
SELECT is((SELECT status::text FROM public.requests WHERE id = 'd5000000-0000-0000-0000-000000000001'), 'in_progress', 'status change persisted atomically');
SELECT is((SELECT user_id FROM public.comments WHERE id = current_setting('test.team_comment_id')::uuid), 'd1000000-0000-0000-0000-000000000003'::uuid, 'comment attribution ignores supplied actor');
SELECT is((SELECT changed_by FROM public.request_status_events WHERE request_id = 'd5000000-0000-0000-0000-000000000001' AND to_status = 'in_progress'), 'd1000000-0000-0000-0000-000000000003'::uuid, 'ordinary status history records actual staff actor');
SELECT ok(EXISTS(SELECT 1 FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000001' AND entity_id='d5000000-0000-0000-0000-000000000001' AND kind='request_status'), 'staff status change also notifies owner so open request pages refresh');
SELECT ok(EXISTS (SELECT 1 FROM public.team_activity WHERE property_id = 'd2000000-0000-0000-0000-000000000001' AND actor_id = 'd1000000-0000-0000-0000-000000000003' AND owner_id = 'd1000000-0000-0000-0000-000000000001'), 'server records staff activity under actual owner');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.team_activity WHERE detail::text LIKE '%' || pg_temp.team_invite_token('test.team_manager') || '%' OR detail::text LIKE '%' || pg_temp.team_invite_token('test.team_manager_old') || '%'), 'audit payloads never contain invitation tokens');

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.accept_team_invitation(pg_temp.team_invite_token('test.team_viewer'))$$, 'viewer accepts invitation');
SELECT lives_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000001')$$, 'viewer can read selected workspace');
SELECT is(public.team_workspace('d2000000-0000-0000-0000-000000000001') -> 'responsible_assignment', 'null'::jsonb, 'viewer sees no assignment editor roster');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', NULL)$$, '42501', NULL, 'viewer cannot change responsibility for a shared property');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'note', '{"text":"Viewer write"}')$$, '42501', NULL, 'viewer cannot add notes');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_status', '{"request_id":"d5000000-0000-0000-0000-000000000001","status":"closed","expected_status":"in_progress"}')$$, '42501', NULL, 'viewer cannot change request status');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_comment', '{"request_id":"d5000000-0000-0000-0000-000000000001","text":"Viewer write"}')$$, '42501', NULL, 'viewer cannot comment');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 3, 'manager', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[], true)$$, '42501', NULL, 'global admin cannot manage another owners private team');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', NULL)$$, '42501', NULL, 'global admin cannot change another owner responsibility');
SELECT throws_ok($$SELECT public.invite_team_member('team-attacker@example.invalid', 'manager', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[])$$, '42501', NULL, 'global admin cannot grant another owner property');
SELECT throws_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000001')$$, '42501', NULL, 'team RPC does not give global admin automatic workspace access');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 3, 'manager', ARRAY['d2000000-0000-0000-0000-000000000003']::uuid[], false)$$, '42501', NULL, 'another owner cannot hijack membership');
SELECT ok(public.team_overview()::text NOT LIKE '%team-manager@example.invalid%', 'another owner overview hides private team roster');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.invite_team_member('team-manager@example.invalid', 'manager', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[])$$, '22023', NULL, 'active membership cannot be replaced by another invitation');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', pg_temp.team_invite_id('test.team_viewer'))$$, '22023', NULL, 'read-only viewer cannot be responsible');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000002', pg_temp.team_invite_id('test.team_manager'))$$, '22023', NULL, 'manager must have selected property to be responsible');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', pg_temp.team_invite_id('test.team_manager'))$$, 'owner assigns active scoped manager');
SELECT throws_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 1, 'viewer', ARRAY['d2000000-0000-0000-0000-000000000001']::uuid[], false)$$, '40001', NULL, 'stale membership update rejected');
SELECT throws_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 3, 'manager', ARRAY['d2000000-0000-0000-0000-000000000003']::uuid[], false)$$, '42501', NULL, 'membership edit cannot grant foreign property');
SELECT throws_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 3, 'manager', '{}'::uuid[], false)$$, '22023', NULL, 'active member cannot have empty selection');
SELECT lives_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 3, 'viewer', ARRAY['d2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004']::uuid[], false)$$, 'owner downgrades manager');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.team_property_responsibles WHERE membership_id = pg_temp.team_invite_id('test.team_manager')), 0::bigint, 'downgrade clears responsibility that now needs manager role');
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated","user_metadata":{"team_role":"manager"}}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'note', '{"text":"Cached manager role"}')$$, '42501', NULL, 'role change is effective immediately despite stale JWT metadata');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', NULL)$$, '42501', NULL, 'downgraded manager cannot change responsibility with stale JWT metadata');
SELECT lives_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000001')$$, 'downgraded member retains selected read access');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 4, 'manager', ARRAY['d2000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004']::uuid[], false)$$, 'owner restores manager role');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', pg_temp.team_invite_id('test.team_manager'))$$, 'owner can reassign restored manager');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', NULL)$$, 'null assignment returns responsibility to owner');
SELECT lives_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', pg_temp.team_invite_id('test.team_manager'))$$, 'owner assigns manager for revoke check');
RESET ROLE;

-- A surviving old grant is insufficient after a property ownership transfer.
UPDATE public.properties SET owner_id = 'd1000000-0000-0000-0000-000000000002'
WHERE id = 'd2000000-0000-0000-0000-000000000004';
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000004')$$, '42501', NULL, 'old grant cannot read property after ownership transfer');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000004', 'note', '{"text":"Old owner grant"}')$$, '42501', NULL, 'old grant cannot mutate transferred property');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000004', NULL)$$, '42501', NULL, 'old grant cannot change responsibility after ownership transfer');
SELECT is(jsonb_array_length(public.team_overview() -> 'workspaces'), 1, 'overview immediately excludes transferred property');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.manage_team_member(pg_temp.team_invite_id('test.team_manager'), 5, 'manager', '{}'::uuid[], true)$$, 'owner revokes membership even when old property was transferred');
SELECT throws_ok($$UPDATE public.team_activity SET actor_id = 'd1000000-0000-0000-0000-000000000001'$$, '42501', NULL, 'owner cannot rewrite audit actors');
SELECT ok(public.team_overview()::text LIKE '%Manager discussion reply%' OR public.team_overview()::text LIKE '%request_comment%', 'owner can inspect staff operation audit');
RESET ROLE;
SELECT is((SELECT status FROM public.team_memberships WHERE id = pg_temp.team_invite_id('test.team_manager')), 'revoked', 'revocation is durable');
SELECT is((SELECT count(*) FROM public.team_property_access WHERE membership_id = pg_temp.team_invite_id('test.team_manager')), 0::bigint, 'revoke clears every property grant');
SELECT is((SELECT count(*) FROM public.team_property_responsibles WHERE membership_id = pg_temp.team_invite_id('test.team_manager')), 0::bigint, 'revoke clears responsible assignments');
SELECT set_config('test.team_activity_count', (SELECT count(*)::text FROM public.team_activity WHERE actor_id = 'd1000000-0000-0000-0000-000000000003'), true);
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000001')$$, '42501', NULL, 'revoked member immediately loses workspace read access');
SELECT throws_ok($$SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001', NULL)$$, '42501', NULL, 'revoked manager cannot change responsibility');
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_comment', '{"request_id":"d5000000-0000-0000-0000-000000000001","text":"After revoke"}')$$, '42501', NULL, 'revoked member cannot add comments');
SELECT is(jsonb_array_length(public.team_overview() -> 'workspaces'), 0, 'revoked member overview has no granted workspaces');
SELECT lives_ok($$DELETE FROM public.comments$$, 'unfiltered comment delete is safely filtered after revocation');
RESET ROLE;
SELECT is((SELECT text FROM public.comments WHERE id = current_setting('test.team_comment_id')::uuid), 'Manager discussion reply', 'revoked author cannot erase staff discussion using direct delete');
SELECT is((SELECT count(*)::text FROM public.team_activity WHERE actor_id = 'd1000000-0000-0000-0000-000000000003'), current_setting('test.team_activity_count'), 'revocation preserves staff audit history');

-- The dedicated team surface leaves existing landlord and tenant workflows usable.
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001', 'request_status', '{"request_id":"d5000000-0000-0000-0000-000000000001","status":"closed","expected_status":"in_progress"}')$$, 'actual owner can still close request through workspace');
SELECT lives_ok($$INSERT INTO public.comments (request_id, user_id, text) VALUES ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Owner follow up')$$, 'ordinary owner comment workflow still works');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT ok(EXISTS (SELECT 1 FROM public.requests WHERE id = 'd5000000-0000-0000-0000-000000000001' AND status = 'closed'), 'linked tenant still sees request and final staff/owner status');
SELECT ok(EXISTS (SELECT 1 FROM public.comments WHERE id = current_setting('test.team_comment_id')::uuid), 'tenant sees actual manager response through existing comments RLS');
SELECT lives_ok($$INSERT INTO public.comments (request_id, user_id, text) VALUES ('d5000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005', 'Tenant follow up')$$, 'ordinary linked tenant can still reply');
SELECT throws_ok($$SELECT public.team_workspace('d2000000-0000-0000-0000-000000000001')$$, '42501', NULL, 'lease tenant relationship alone does not grant owner team surface');
RESET ROLE;

-- Bounded payloads must report omitted data, including the owner audit journal.
INSERT INTO public.requests (id, owner_id, property_id, tenant_id, title, created_at)
VALUES ('d5000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'Latest fixture request', now() + interval '2 days');
INSERT INTO public.requests (owner_id, property_id, tenant_id, title, created_at)
SELECT 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'Bounded fixture request ' || n, now() + interval '1 day' + n * interval '1 second'
FROM generate_series(1, 205) AS n;
INSERT INTO public.comments (request_id, user_id, text)
SELECT 'd5000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', 'Bounded fixture comment ' || n
FROM generate_series(1, 505) AS n;
INSERT INTO public.team_activity (owner_id, actor_id, property_id, action, detail)
SELECT 'd1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'property_note', jsonb_build_object('text', 'Bounded fixture note ' || n)
FROM generate_series(1, 110) AS n;
SELECT set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.team_bounded_workspace', public.team_workspace('d2000000-0000-0000-0000-000000000001')::text, true);
SELECT is(jsonb_array_length(current_setting('test.team_bounded_workspace')::jsonb -> 'requests'), 200, 'workspace request list is bounded');
SELECT is(jsonb_array_length(current_setting('test.team_bounded_workspace')::jsonb -> 'comments'), 500, 'workspace discussion list is bounded');
SELECT is(jsonb_array_length(current_setting('test.team_bounded_workspace')::jsonb -> 'notes'), 50, 'workspace notes list is bounded');
SELECT ok((current_setting('test.team_bounded_workspace')::jsonb ->> 'requests_truncated')::boolean AND (current_setting('test.team_bounded_workspace')::jsonb ->> 'comments_truncated')::boolean AND (current_setting('test.team_bounded_workspace')::jsonb ->> 'notes_truncated')::boolean, 'workspace explicitly marks every truncated collection');
SELECT is(jsonb_array_length(public.team_overview() -> 'events'), 100, 'owner audit journal is bounded');
SELECT ok((public.team_overview() ->> 'events_truncated')::boolean, 'owner knows older journal entries are omitted');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{}', true);
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.team_overview()$$, '42501', NULL, 'anonymous cannot call team overview');
SELECT throws_ok($$SELECT public.accept_team_invitation(pg_temp.team_invite_token('test.team_manager'))$$, '42501', NULL, 'anonymous cannot consume invitation');
SELECT throws_ok($$SELECT * FROM public.team_activity$$, '42501', NULL, 'anonymous cannot read staff audit');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
