BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('d1000000-0000-0000-0000-000000000001','object-owner@example.invalid',now(),'{"role":"owner"}'),
 ('d1000000-0000-0000-0000-000000000002','object-other@example.invalid',now(),'{"role":"owner"}'),
 ('d1000000-0000-0000-0000-000000000003','object-manager@example.invalid',now(),'{"role":"tenant"}'),
 ('d1000000-0000-0000-0000-000000000004','object-viewer@example.invalid',now(),'{"role":"tenant"}'),
 ('d1000000-0000-0000-0000-000000000005','object-unassigned@example.invalid',now(),'{"role":"tenant"}'),
 ('d1000000-0000-0000-0000-000000000006','object-revoked@example.invalid',now(),'{"role":"tenant"}'),
 ('d1000000-0000-0000-0000-000000000007','object-invited@example.invalid',now(),'{"role":"tenant"}'),
 ('d1000000-0000-0000-0000-000000000008','object-renter@example.invalid',now(),'{"role":"tenant"}'),
 ('d1000000-0000-0000-0000-000000000009','object-admin@example.invalid',now(),'{"role":"owner"}');
UPDATE public.user_roles SET role='admin' WHERE user_id='d1000000-0000-0000-0000-000000000009';
INSERT INTO public.properties(id,owner_id,name,address,description) VALUES
 ('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Selected','PRIVATE_ADDRESS','PRIVATE_OBJECT_NOTE'),
 ('d2000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','Not selected','OTHER_ADDRESS','OTHER_DESCRIPTION'),
 ('d2000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000002','Foreign','FOREIGN_ADDRESS','FOREIGN_DESCRIPTION');
INSERT INTO public.team_memberships(id,owner_id,email,user_id,role,status) VALUES
 ('d3000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','object-manager@example.invalid','d1000000-0000-0000-0000-000000000003','manager','active'),
 ('d3000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','object-viewer@example.invalid','d1000000-0000-0000-0000-000000000004','viewer','active'),
 ('d3000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000001','object-unassigned@example.invalid','d1000000-0000-0000-0000-000000000005','manager','active'),
 ('d3000000-0000-0000-0000-000000000004','d1000000-0000-0000-0000-000000000001','object-revoked@example.invalid','d1000000-0000-0000-0000-000000000006','manager','revoked'),
 ('d3000000-0000-0000-0000-000000000005','d1000000-0000-0000-0000-000000000001','object-invited@example.invalid','d1000000-0000-0000-0000-000000000007','viewer','invited');
INSERT INTO public.team_property_access VALUES
 ('d3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001'),
 ('d3000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000001'),
 ('d3000000-0000-0000-0000-000000000003','d2000000-0000-0000-0000-000000000002'),
 ('d3000000-0000-0000-0000-000000000004','d2000000-0000-0000-0000-000000000001'),
 ('d3000000-0000-0000-0000-000000000005','d2000000-0000-0000-0000-000000000001');
INSERT INTO public.tenants(id,owner_id,user_id,name) VALUES
 ('d4000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000008','Renter');
DELETE FROM public.notifications;

-- Real property/unit writes drive the canonical audit trigger.
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000001"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.properties SET description='CHANGED_PRIVATE_NOTE' WHERE id='d2000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),2::bigint,'property update notifies exactly scoped manager and viewer');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id IN ('d1000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000004')),2::bigint,'manager and viewer both receive operational event');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000001'),0::bigint,'actor owner does not notify themselves');
SELECT ok((SELECT bool_and(body NOT LIKE '%PRIVATE%' AND title NOT LIKE '%PRIVATE%' AND body NOT LIKE '%Selected%') FROM public.notifications),'generic event excludes descriptions addresses and object content');
SELECT ok((SELECT bool_and(entity_type='property' AND entity_id='d2000000-0000-0000-0000-000000000001' AND href='/team' AND kind='object_activity') FROM public.notifications),'object events use canonical property identity and internal route');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id IN ('d1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000005','d1000000-0000-0000-0000-000000000006','d1000000-0000-0000-0000-000000000007','d1000000-0000-0000-0000-000000000008','d1000000-0000-0000-0000-000000000009')),0::bigint,'foreign owner, unassigned, revoked, invited, tenant and global admin receive no subscription');
DELETE FROM public.notifications;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000009"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.properties SET address='ADMIN_CHANGE' WHERE id='d2000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),3::bigint,'admin action reaches owner and scoped team');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000001'),1::bigint,'owner learns about other actor property action');
DELETE FROM public.notifications;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000001"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.units(id,property_id,name,area) VALUES ('d5000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','PRIVATE_UNIT_NAME',40);
UPDATE public.units SET area=41 WHERE id='d5000000-0000-0000-0000-000000000001';
DELETE FROM public.units WHERE id='d5000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),6::bigint,'unit create update delete each notify selected team');
DELETE FROM public.notifications;

-- Team actions reuse the existing authorized RPC; status changes have one source.
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000003"}',true);
SET LOCAL ROLE authenticated;
SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001','note','{"text":"SECRET_INTERNAL_NOTE"}');
SELECT throws_ok($$SELECT private.notify_object_activity('d2000000-0000-0000-0000-000000000001',NULL,'forged',gen_random_uuid(),'Forged',true)$$,'42501',NULL,'browser cannot forge object notification fanout');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),2::bigint,'manager note reaches owner and viewer, excludes actor');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000003'),0::bigint,'manager actor excluded');
SELECT ok((SELECT bool_and(body NOT LIKE '%SECRET_INTERNAL_NOTE%') FROM public.notifications),'internal note never copied');
DELETE FROM public.notifications;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT public.set_team_responsible('d2000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),2::bigint,'responsible assignment notifies scoped team');
DELETE FROM public.notifications;
SET LOCAL ROLE authenticated;
SELECT public.set_catalog_property_status('d2000000-0000-0000-0000-000000000001','active','archived');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),2::bigint,'archive emits once despite property audit plus team note');
DELETE FROM public.notifications;
SET LOCAL ROLE authenticated;
SELECT public.set_catalog_property_status('d2000000-0000-0000-0000-000000000001','archived','active');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),2::bigint,'restore emits once');
DELETE FROM public.notifications;

-- Requests already notify owner/tenant; the new layer adds team exactly once.
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000008"}',true);
INSERT INTO public.requests(id,owner_id,property_id,tenant_id,title,description,category) VALUES
 ('d6000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','PRIVATE_REQUEST','SECRET_DESCRIPTION','repair');
SELECT is((SELECT count(*) FROM public.notifications WHERE kind='request_created' AND user_id IN ('d1000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000004')),2::bigint,'new request team fanout does not duplicate initial status audit');
SELECT is((SELECT count(*) FROM public.notifications WHERE kind='request_created' AND user_id='d1000000-0000-0000-0000-000000000001'),1::bigint,'existing owner request event preserved once');
DELETE FROM public.notifications;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000003"}',true);
SET LOCAL ROLE authenticated;
SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001','request_status','{"request_id":"d6000000-0000-0000-0000-000000000001","expected_status":"new","status":"in_progress"}');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE kind='request_status' AND user_id='d1000000-0000-0000-0000-000000000004'),1::bigint,'status update reaches other team member once');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000001'),1::bigint,'manager status preserves single owner notification');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000008' AND kind='request_status'),1::bigint,'tenant receives only their existing status notification');
DELETE FROM public.notifications;
SET LOCAL ROLE authenticated;
SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001','request_comment','{"request_id":"d6000000-0000-0000-0000-000000000001","text":"SECRET_COMMENT"}');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE kind='request_comment' AND user_id='d1000000-0000-0000-0000-000000000004'),1::bigint,'team comment notifies other team member only once');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000001'),1::bigint,'existing owner comment event is not duplicated');
SELECT ok((SELECT bool_and(body NOT LIKE '%SECRET_COMMENT%') FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000004'),'team comment event excludes comment text');
DELETE FROM public.notifications;

-- Publication RPC and recruitment audit events never forward operator snapshots.
INSERT INTO public.property_listings(id,public_id,property_id,draft) VALUES
 ('d7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000001',jsonb_build_object('title','Public offer','location','Public location','monthly_rent',40000,'deposit',40000,'available_from',CURRENT_DATE,'photos',jsonb_build_array('d7000000-0000-0000-0000-000000000002/cover.png')));
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT public.act_on_property_listing('d7000000-0000-0000-0000-000000000001','publish',1);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE kind='object_activity'),2::bigint,'publication reaches scoped team');
DELETE FROM public.notifications;
SET LOCAL ROLE authenticated;
SELECT public.act_on_property_listing('d7000000-0000-0000-0000-000000000001','pause',2);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE kind='object_activity'),2::bigint,'publication pause reaches scoped team');
DELETE FROM public.notifications;
INSERT INTO public.recruitment_events(listing_id,actor_id,action,detail) VALUES
 ('d7000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','draft_saved','{"private":"SECRET_DRAFT"}');
SELECT is((SELECT count(*) FROM public.notifications),0::bigint,'draft autosaves do not produce noisy activity');
INSERT INTO public.rental_applications(id,listing_id,applicant_id,name,email,phone,offer) VALUES ('d7000000-0000-0000-0000-000000000003','d7000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000008','SECRET_CANDIDATE','SECRET_EMAIL','1234567','{}');
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000003"}',true);
INSERT INTO public.recruitment_events(listing_id,application_id,actor_id,action,detail) VALUES
 ('d7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000003','schedule','{"email":"SECRET_CANDIDATE@example.invalid","phone":"SECRET_PHONE","operator_note":"SECRET_OPERATOR_NOTE"}');
SELECT is((SELECT count(*) FROM public.notifications),1::bigint,'manager schedules: owner receives safe activity; viewer is not a candidate recipient');
SELECT ok((SELECT bool_and(body NOT LIKE '%SECRET%' AND title NOT LIKE '%SECRET%') FROM public.notifications),'viewer event never contains candidate contacts or operator notes');
DELETE FROM public.notifications;
INSERT INTO public.recruitment_events(listing_id,application_id,actor_id,action,detail) VALUES
 ('d7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000008','applied','{}');
SELECT is((SELECT count(*) FROM public.notifications),1::bigint,'candidate applied audit adds manager only; canonical workflow owns owner event');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000001'),0::bigint,'candidate applied audit does not duplicate owner notification');
DELETE FROM public.notifications;

-- Real repair RPC: same core owner event, new team activity, no amount/contact leaks.
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000003"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.object_repair',public.save_repair_job('d2000000-0000-0000-0000-000000000001',NULL,jsonb_build_object('title','SECRET_REPAIR_TITLE','description','SECRET_REPAIR_DESCRIPTION','scheduled_date',CURRENT_DATE,'due_date',CURRENT_DATE+3,'estimate_items',jsonb_build_array(jsonb_build_object('name','SECRET_LABOUR','quantity',1,'unit_price',12345))),NULL)::text,true);
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000001' AND kind='repair_status'),1::bigint,'existing repair owner notification preserved once');
SELECT is((SELECT count(*) FROM public.notifications WHERE kind='repair_status' AND user_id='d1000000-0000-0000-0000-000000000004'),1::bigint,'repair actor excluded; scoped viewer receives generic activity');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000008'),0::bigint,'unrelated tenant receives no unpublished repair activity');
SELECT ok((SELECT bool_and(body NOT LIKE '%SECRET%' AND body NOT LIKE '%12345%' AND title NOT LIKE '%SECRET%') FROM public.notifications WHERE user_id='d1000000-0000-0000-0000-000000000004'),'repair activity excludes quote and private description');
DELETE FROM public.notifications;

-- Idempotency and fresh scopes are verified independently from rendering.
SELECT private.notify_object_activity('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','retry','d9000000-0000-0000-0000-000000000001','Test event',true);
SELECT private.notify_object_activity('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','retry','d9000000-0000-0000-0000-000000000001','Test event',true);
SELECT is((SELECT count(*) FROM public.notifications),2::bigint,'same source event dedupes per recipient');
DELETE FROM public.notifications;
-- Channel topics follow the original event kind, and deliveries re-check scope.
UPDATE private.telegram_config SET enabled=true,bot_username='object_test_bot';
INSERT INTO private.telegram_connections(user_id,chat_id) VALUES
 ('d1000000-0000-0000-0000-000000000003','12345003'),('d1000000-0000-0000-0000-000000000004','12345004');
INSERT INTO private.telegram_preferences(user_id,topics) VALUES
 ('d1000000-0000-0000-0000-000000000003',ARRAY['objects']),('d1000000-0000-0000-0000-000000000004',ARRAY['requests']);
SELECT is((SELECT count(*) FROM private.telegram_deliveries),0::bigint,'connecting Telegram does not replay older object activity');
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000001"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.properties SET description='QUEUED_PRIVATE_DESCRIPTION' WHERE id='d2000000-0000-0000-0000-000000000001';
INSERT INTO public.comments(request_id,user_id,text) VALUES ('d6000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','QUEUED_SECRET_COMMENT');
RESET ROLE;
SELECT is((SELECT count(*) FROM private.telegram_deliveries),2::bigint,'object and request topics each enqueue only subscribed channel');
SELECT is((SELECT count(*) FROM private.telegram_deliveries WHERE user_id='d1000000-0000-0000-0000-000000000003' AND kind='object_activity'),1::bigint,'objects-only member receives property event');
SELECT is((SELECT count(*) FROM private.telegram_deliveries WHERE user_id='d1000000-0000-0000-0000-000000000004' AND kind='request_comment'),1::bigint,'requests-only member receives request event');
SELECT ok(NOT EXISTS(SELECT 1 FROM private.telegram_deliveries WHERE user_id='d1000000-0000-0000-0000-000000000003' AND kind='request_comment'),'disabling requests also mutes team request activity');
UPDATE public.team_memberships SET status='revoked' WHERE id='d3000000-0000-0000-0000-000000000001';
DELETE FROM public.team_property_access WHERE membership_id='d3000000-0000-0000-0000-000000000002';
SET LOCAL ROLE service_role;
SELECT is(public.claim_telegram_deliveries(10),'[]'::jsonb,'revoked or unassigned recipients are not returned to sender');
RESET ROLE;
SELECT is((SELECT count(*) FROM private.telegram_deliveries WHERE status='cancelled' AND error_code='event_unavailable'),2::bigint,'queued object and request events cancelled after access changes');
DELETE FROM public.notifications;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000001"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.properties SET description='AFTER_REVOKE' WHERE id='d2000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT count(*) FROM public.notifications),0::bigint,'revocation and removing property assignment immediately stop future fanout');
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000004"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.act_on_team_property('d2000000-0000-0000-0000-000000000001','note','{"text":"forged"}')$$,'42501',NULL,'viewer with removed scope cannot forge underlying action');
SELECT throws_ok($$INSERT INTO public.property_activity_events(property_id,event_type,entity_type,entity_id,title) VALUES('d2000000-0000-0000-0000-000000000001','property_updated','property','d2000000-0000-0000-0000-000000000001','Forged')$$,'42501',NULL,'browser cannot insert canonical audit event');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.notifications$$,'42501',NULL,'anonymous visitor cannot read activity inbox');
SELECT throws_ok($$SELECT private.notify_object_activity('d2000000-0000-0000-0000-000000000001',NULL,'forged',gen_random_uuid(),'Forged',true)$$,'42501',NULL,'anonymous cannot forge object activity');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
