BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

-- Fixed, fictional identities and dates make role boundaries and timezone
-- assertions reproducible. Every fixture is removed by the final rollback.
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('ca100000-0000-4000-8000-000000000001','calendar-owner@example.invalid',now(),'{"name":"Calendar Owner","role":"owner"}'),
 ('ca100000-0000-4000-8000-000000000002','calendar-other-owner@example.invalid',now(),'{"name":"OTHER_OWNER_NAME","role":"owner"}'),
 ('ca100000-0000-4000-8000-000000000003','calendar-manager@example.invalid',now(),'{"name":"CALENDAR_MANAGER_NAME","role":"tenant"}'),
 ('ca100000-0000-4000-8000-000000000004','calendar-viewer@example.invalid',now(),'{"name":"Calendar Viewer","role":"tenant"}'),
 ('ca100000-0000-4000-8000-000000000005','calendar-tenant@example.invalid',now(),'{"name":"Calendar Tenant","role":"tenant"}'),
 ('ca100000-0000-4000-8000-000000000006','calendar-admin@example.invalid',now(),'{"name":"Calendar Admin","role":"owner"}'),
 ('ca100000-0000-4000-8000-000000000007','calendar-candidate@example.invalid',now(),'{"name":"CALENDAR_CANDIDATE_NAME","role":"tenant"}'),
 ('ca100000-0000-4000-8000-000000000008','calendar-other-tenant@example.invalid',now(),'{"name":"OTHER_TENANT_SECRET","role":"tenant"}'),
 ('ca100000-0000-4000-8000-000000000009','calendar-outsider@example.invalid',now(),'{"name":"Outsider","role":"tenant"}');
UPDATE public.user_roles SET role='admin' WHERE user_id='ca100000-0000-4000-8000-000000000006';

INSERT INTO public.properties(id,owner_id,name,address,description) VALUES
 ('ca200000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','CALENDAR_INTERNAL_PROPERTY','PRIVATE_ADDRESS_A','PRIVATE_ACCESS_CODE'),
 ('ca200000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001','INTERNAL_DRAFT_ONLY_PROPERTY','PRIVATE_ADDRESS_B','PRIVATE_DESCRIPTION'),
 ('ca200000-0000-4000-8000-000000000003','ca100000-0000-4000-8000-000000000002','Mixed-role home','Mixed-role address',''),
 ('ca200000-0000-4000-8000-000000000004','ca100000-0000-4000-8000-000000000002','CANDIDATE_INTERNAL_PROPERTY_SECRET','CANDIDATE_INTERNAL_ADDRESS_SECRET',''),
 ('ca200000-0000-4000-8000-000000000005','ca100000-0000-4000-8000-000000000001','Repair-only tenant property','','');
INSERT INTO public.units(id,property_id,name) VALUES
 ('ca210000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','Unit 1'),
 ('ca210000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000001','Unit 2');
INSERT INTO public.tenants(id,owner_id,user_id,name,email,phone) VALUES
 ('ca300000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000005','Calendar Tenant','TENANT_CONTACT_SECRET@example.invalid','TENANT_PHONE_SECRET'),
 ('ca300000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000008','OTHER_TENANT_SECRET','OTHER_TENANT_CONTACT_SECRET@example.invalid',''),
 ('ca300000-0000-4000-8000-000000000003','ca100000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000003','Mixed-role Tenant','','');
INSERT INTO public.lease_agreements(id,owner_id,property_id,unit_id,tenant_id,start_date,end_date,monthly_payment,payment_due_day,status,contract_details,signed_document_file) VALUES
 ('ca400000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','ca210000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','2026-11-03','2026-11-25',10000,15,'active','{"passport":"PASSPORT_SECRET","inventory":"INVENTORY_SECRET"}','DOCUMENT_PATH_SECRET.pdf'),
 ('ca400000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','ca210000-0000-4000-8000-000000000002','ca300000-0000-4000-8000-000000000002','2026-11-05','2026-11-27',20000,16,'active','{}','other-test.pdf'),
 ('ca400000-0000-4000-8000-000000000003','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000002',NULL,'ca300000-0000-4000-8000-000000000002','2026-11-04','2026-11-26',30000,17,'active','{}','unselected-test.pdf'),
 ('ca400000-0000-4000-8000-000000000004','ca100000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000003',NULL,'ca300000-0000-4000-8000-000000000003','2026-11-07','2026-11-28',40000,18,'active','{}','mixed-test.pdf'),
 ('ca400000-0000-4000-8000-000000000005','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000002',NULL,'ca300000-0000-4000-8000-000000000001','2026-11-06','2026-11-29',50000,19,'draft','{"private":"DRAFT_LEASE_SECRET"}',NULL);

-- Separate periods avoid the generated monthly rent row. One row intentionally
-- models a pre-ledger fully paid charge with paid_amount still zero.
INSERT INTO public.rent_charges(id,agreement_id,owner_id,tenant_id,period_start,due_date,amount,adjustment_amount,adjustment_reason,paid_amount,paid_at) VALUES
 ('ca410000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','2026-09-01','2026-11-10',2000,500,'Fictional adjustment',250,NULL),
 ('ca410000-0000-4000-8000-000000000002','ca400000-0000-4000-8000-000000000003','ca100000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000002','2026-10-01','2026-11-11',1000,0,NULL,0,'2026-11-11T10:00:00Z');

INSERT INTO public.team_memberships(id,owner_id,email,user_id,role,status) VALUES
 ('ca500000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','calendar-manager@example.invalid','ca100000-0000-4000-8000-000000000003','manager','active'),
 ('ca500000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001','calendar-viewer@example.invalid','ca100000-0000-4000-8000-000000000004','viewer','active');
INSERT INTO public.team_property_access VALUES
 ('ca500000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001'),
 ('ca500000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000001');
INSERT INTO public.team_property_responsibles VALUES ('ca200000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001');

INSERT INTO public.lease_handovers(id,agreement_id,kind,status,inspection_date,keys_count,checklist,condition_note,reviewed_at) VALUES
 ('ca600000-0000-4000-8000-000000000001','ca400000-0000-4000-8000-000000000001','move_in','draft','2026-11-12',1,'{}','DRAFT_INSPECTION_SECRET',NULL),
 ('ca600000-0000-4000-8000-000000000002','ca400000-0000-4000-8000-000000000001','move_out','pending','2026-11-24',1,'{}','HANDOVER_CONDITION_SECRET',NULL),
 ('ca600000-0000-4000-8000-000000000003','ca400000-0000-4000-8000-000000000002','move_in','confirmed','2026-11-05',1,'{}','OTHER_HANDOVER_SECRET',now());

INSERT INTO public.requests(id,owner_id,property_id,tenant_id,title,category) VALUES
 ('ca700000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000001','Tenant repair','repair'),
 ('ca700000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','ca300000-0000-4000-8000-000000000002','Other tenant repair','repair'),
 ('ca700000-0000-4000-8000-000000000003','ca100000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000003','ca300000-0000-4000-8000-000000000003','Mixed-role own repair','repair'),
 ('ca700000-0000-4000-8000-000000000004','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000005','ca300000-0000-4000-8000-000000000001','Repair without lease','repair');
INSERT INTO public.repair_jobs(id,owner_id,property_id,request_id,title,description,scheduled_date,due_date,estimate_items,estimated_total,status,published_at) VALUES
 ('ca710000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','ca700000-0000-4000-8000-000000000001','Own repair','REPAIR_PRIVATE_DESCRIPTION','2026-11-17','2026-11-19','[{"name":"INTERNAL_ESTIMATE_SECRET","quantity":1,"unit_price":938.73,"amount":938.73}]',938.73,'approved',now()),
 ('ca710000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','ca700000-0000-4000-8000-000000000002','OTHER_TENANT_REPAIR_SECRET','','2026-11-18','2026-11-20','[]',100,'in_progress',now()),
 ('ca710000-0000-4000-8000-000000000003','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',NULL,'UNPUBLISHED_REPAIR_SECRET','','2026-11-18','2026-11-21','[]',100,'draft',NULL),
 ('ca710000-0000-4000-8000-000000000004','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000002',NULL,'UNSELECTED_REPAIR_SECRET','','2026-11-18','2026-11-22','[]',100,'approved',now()),
 ('ca710000-0000-4000-8000-000000000005','ca100000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000003','ca700000-0000-4000-8000-000000000003','Mixed-role own repair','','2026-11-18','2026-11-23','[]',100,'approved',now()),
 ('ca710000-0000-4000-8000-000000000006','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000005','ca700000-0000-4000-8000-000000000004','Repair without lease','','2026-11-18','2026-11-23','[]',100,'approved',now()),
 ('ca710000-0000-4000-8000-000000000007','ca100000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001',NULL,'CANCELLED_REPAIR_SECRET','','2026-11-18','2026-11-24','[]',100,'cancelled',NULL);
INSERT INTO public.repair_contractors(id,owner_id,name,phone) VALUES
 ('ca720000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001','PRIVATE_CONTRACTOR_NAME','PRIVATE_CONTRACTOR_PHONE');
UPDATE public.repair_jobs SET contractor_id='ca720000-0000-4000-8000-000000000001',
 contractor_snapshot='{"name":"PRIVATE_CONTRACTOR_NAME","phone":"PRIVATE_CONTRACTOR_PHONE","specialty":"Test","email":"test@example.invalid"}'
WHERE id='ca710000-0000-4000-8000-000000000001';

INSERT INTO public.property_listings(id,property_id,status,draft,published_snapshot) VALUES
 ('ca800000-0000-4000-8000-000000000001','ca200000-0000-4000-8000-000000000001','published','{"title":"Public selected home"}','{"title":"Public selected home","location":"Public location"}'),
 ('ca800000-0000-4000-8000-000000000002','ca200000-0000-4000-8000-000000000004','published','{"title":"Public vacancy"}','{"title":"Public vacancy","location":"Public district"}');
INSERT INTO public.rental_applications(id,listing_id,applicant_id,name,email,phone,message,offer,status,showing_at,operator_note) VALUES
 ('ca810000-0000-4000-8000-000000000001','ca800000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000007','CALENDAR_CANDIDATE_NAME','CANDIDATE_CONTACT_SECRET@example.invalid','CANDIDATE_PHONE_SECRET','','{"title":"Public selected home","location":"Public location"}','showing','2026-11-01T22:30:00Z','OPERATOR_NOTE_SECRET'),
 ('ca810000-0000-4000-8000-000000000002','ca800000-0000-4000-8000-000000000002','ca100000-0000-4000-8000-000000000007','CALENDAR_CANDIDATE_NAME','CANDIDATE_CONTACT_SECRET@example.invalid','CANDIDATE_PHONE_SECRET','','{"title":"Public vacancy","location":"Public district"}','showing','2026-11-30T22:30:00Z','OPERATOR_NOTE_SECRET'),
 ('ca810000-0000-4000-8000-000000000003','ca800000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000008','STALE_SHOWING_SECRET','other-candidate@example.invalid','00000000000','','{"title":"Public selected home"}','shortlisted','2026-11-14T12:00:00Z',''),
 ('ca810000-0000-4000-8000-000000000004','ca800000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000004','Viewer own application','calendar-viewer@example.invalid','00000000000','','{"title":"Public selected home"}','showing','2026-11-15T12:00:00Z','VIEWER_INTERNAL_NOTE_SECRET');

CREATE FUNCTION pg_temp.calendar_events() RETURNS SETOF jsonb LANGUAGE sql AS $$
 SELECT value FROM jsonb_array_elements(current_setting('test.calendar')::jsonb->'events');
$$;
CREATE FUNCTION pg_temp.calendar_event(p_kind text,p_source uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT e FROM pg_temp.calendar_events() e WHERE e->>'kind'=p_kind AND e->>'source_id'=p_source::text;
$$;

SELECT ok(NOT has_function_privilege('anon','public.rental_calendar(date,date,text,uuid,uuid)','EXECUTE'),'anonymous calendar execution is revoked');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.rental_calendar(date,date,text,uuid,uuid)'::regprocedure),'public calendar wrapper uses invoker rights');
SELECT ok(NOT has_function_privilege('anon','public.rental_calendar_application(uuid)','EXECUTE'),'anonymous selected application read is revoked');
SELECT ok(NOT has_function_privilege('anon','public.rental_calendar_repair(uuid)','EXECUTE'),'anonymous selected repair read is revoked');
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.rental_calendar('2026-11-01','2026-12-01')$$,'42501',NULL,'authenticated database role still requires a user identity');
SELECT throws_ok($$SELECT public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')$$,'42501',NULL,'selected application read still requires a user identity');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.rental_calendar('2026-11-01','2026-12-01')$$,'42501',NULL,'anonymous browser cannot invoke calendar');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.rental_calendar(NULL,'2026-12-01')$$,'22023',NULL,'null lower bound rejected');
SELECT throws_ok($$SELECT public.rental_calendar('2026-11-01',NULL)$$,'22023',NULL,'null upper bound rejected');
SELECT throws_ok($$SELECT public.rental_calendar('2026-11-01','2026-11-01')$$,'22023',NULL,'empty range rejected');
SELECT throws_ok($$SELECT public.rental_calendar('2026-12-01','2026-11-01')$$,'22023',NULL,'reversed range rejected');
SELECT throws_ok($$SELECT public.rental_calendar('2026-11-01','2027-01-03')$$,'22023',NULL,'period longer than 62 days rejected');
SELECT throws_ok($$SELECT public.rental_calendar('-infinity','2026-12-01')$$,'22023',NULL,'nonfinite date rejected');
SELECT throws_ok($$SELECT public.rental_calendar('2026-11-01','2026-12-01','Not/A_Timezone')$$,'22023',NULL,'unknown timezone rejected');
SELECT throws_ok($$SELECT public.rental_calendar('2026-11-01','2026-12-01',NULL)$$,'22023',NULL,'null timezone rejected');
SELECT lives_ok($$SELECT public.rental_calendar('2026-11-01','2027-01-02')$$,'maximum 62 day range accepted');
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01')::text,true);
SELECT is(public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')->'application'->>'id','ca810000-0000-4000-8000-000000000001','owner opens exactly the calendar selected application');
SELECT is((public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')->>'owner')::boolean,true,'owner selected application has owner-side capability');
SELECT is(public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')->'application'->>'operator_note','OPERATOR_NOTE_SECRET','authorized owner can read the existing operational snapshot');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000002') IS NULL,'owner cannot open a guessed other-owner application');
SELECT ok(public.rental_calendar_application(NULL) IS NULL AND public.rental_calendar_application('ca810000-0000-4000-8000-000000009999') IS NULL,'null or nonexistent selected application is unavailable');
SELECT is(current_setting('test.calendar')::jsonb->>'from','2026-11-01','response identifies inclusive range start');
SELECT is(current_setting('test.calendar')::jsonb->>'to','2026-12-01','response identifies exclusive range end');
SELECT is(current_setting('test.calendar')::jsonb->>'timezone','Europe/Moscow','default timezone is explicit');
SELECT results_eq($$SELECT DISTINCT e->>'kind' FROM pg_temp.calendar_events() e ORDER BY 1$$,ARRAY['move_in','move_out','payment','repair','showing']::text[],'owner calendar combines all five sources');
SELECT is((pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000001')->>'amount')::numeric,2500::numeric,'payment includes signed adjustment');
SELECT is((pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000001')->>'paid_amount')::numeric,250::numeric,'partial ledger amount is preserved');
SELECT is(pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000001')->>'status','partial','partial payment is not presented as fully paid');
SELECT is(pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000001')->>'agreement_id','ca400000-0000-4000-8000-000000000001','payment action points to exact agreement');
SELECT is(pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000001')->>'id','payment:ca410000-0000-4000-8000-000000000001','payment action identifies exact charge');
SELECT is(pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000002')->>'status','paid','legacy paid_at charge remains paid');
SELECT is((pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000002')->>'paid_amount')::numeric,1000::numeric,'legacy paid_at charge displays full paid amount');
SELECT is(pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000001')->>'date','2026-11-12','owner sees actual draft inspection date instead of agreement start');
SELECT is(pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000001')->>'status','draft','owner can distinguish draft handover');
SELECT is((pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000001')->>'estimated')::boolean,false,'actual inspection is not labelled an estimate');
SELECT is((SELECT count(*) FROM pg_temp.calendar_events() e WHERE e->>'id'='move_in:ca400000-0000-4000-8000-000000000001'),1::bigint,'inspection replaces planned start without duplication');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'agreement_id'='ca400000-0000-4000-8000-000000000005'),'draft lease is not a scheduled handover');
SELECT is(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000001')->>'date','2026-11-19','repair is scheduled once at its due date');
SELECT is(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000001')->>'request_id','ca700000-0000-4000-8000-000000000001','repair preserves exact linked request for navigation');
SELECT is(pg_temp.calendar_event('showing','ca810000-0000-4000-8000-000000000001')->>'date','2026-11-02','showing crosses midnight in selected timezone');
SELECT is((pg_temp.calendar_event('showing','ca810000-0000-4000-8000-000000000001')->>'starts_at')::timestamptz,'2026-11-01T22:30:00Z'::timestamptz,'showing keeps the original instant');
SELECT ok(pg_temp.calendar_event('showing','ca810000-0000-4000-8000-000000000003') IS NULL,'retained date on shortlisted application is not an active showing');
SELECT ok(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000007') IS NULL,'cancelled repair is not a deadline');
SELECT is(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000001')->>'responsible_id','ca100000-0000-4000-8000-000000000003','assigned responsible uses stable manager user identity');
SELECT is(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000004')->>'responsible_id','ca100000-0000-4000-8000-000000000001','unassigned property falls back to its owner');
SELECT ok(current_setting('test.calendar') NOT LIKE '%PASSPORT_SECRET%' AND current_setting('test.calendar') NOT LIKE '%INVENTORY_SECRET%' AND current_setting('test.calendar') NOT LIKE '%DOCUMENT_PATH_SECRET%' AND current_setting('test.calendar') NOT LIKE '%CANDIDATE_CONTACT_SECRET%' AND current_setting('test.calendar') NOT LIKE '%OPERATOR_NOTE_SECRET%','calendar returns dates and references without document or contact payloads');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'property_id' IN ('ca200000-0000-4000-8000-000000000003','ca200000-0000-4000-8000-000000000004')),'owner has no events from another owner');
SELECT ok(NOT (current_setting('test.calendar')::jsonb->>'truncated')::boolean,'small result does not claim truncation');
SELECT is((SELECT count(*) FROM jsonb_array_elements(public.rental_calendar('2026-11-10','2026-11-11','Pacific/Honolulu')->'events') e WHERE e->>'source_id'='ca410000-0000-4000-8000-000000000001' AND e->>'date'='2026-11-10'),1::bigint,'date-only payment does not shift with timezone');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01')::text,true);
SELECT is(pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000001')->>'date','2026-11-03','tenant draft inspection falls back to agreement date');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000001') IS NULL,'a lease on the property does not grant access to other candidates');
SELECT is(pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000001')->>'status','planned','tenant cannot infer hidden draft status');
SELECT is((pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000001')->>'estimated')::boolean,true,'tenant planned date is labelled estimated');
SELECT is(pg_temp.calendar_event('move_out','ca400000-0000-4000-8000-000000000001')->>'date','2026-11-24','tenant sees own submitted inspection date');
SELECT ok(pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000002') IS NULL,'tenant cannot see another lease on the same property');
SELECT is((SELECT count(*) FROM pg_temp.calendar_events() e WHERE e->>'kind'='payment'),2::bigint,'tenant receives only their two charges');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'kind'='payment' AND e->>'agreement_id'<>'ca400000-0000-4000-8000-000000000001'),'same-property ownership does not expose other tenant payments');
SELECT ok(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000001') IS NOT NULL,'tenant sees published own-request repair');
SELECT set_config('test.calendar_selected_repair',public.rental_calendar_repair('ca710000-0000-4000-8000-000000000001')::text,true);
SELECT ok(jsonb_array_length(current_setting('test.calendar_selected_repair')::jsonb->'jobs')=1
 AND current_setting('test.calendar_selected_repair')::jsonb->'jobs'->0->>'id'='ca710000-0000-4000-8000-000000000001'
 AND current_setting('test.calendar_selected_repair')::jsonb->'jobs'->0->>'estimated_total' IS NULL
 AND current_setting('test.calendar_selected_repair')::jsonb->'jobs'->0->>'actual_amount' IS NULL
 AND current_setting('test.calendar_selected_repair')::jsonb->'jobs'->0->>'contractor_id' IS NULL
 AND current_setting('test.calendar_selected_repair')::jsonb->'jobs'->0->>'contractor_snapshot' IS NULL
 AND current_setting('test.calendar_selected_repair')::jsonb->'jobs'->0->'estimate_items'='[]'::jsonb,
 'tenant exact repair context preserves own job and redacts real quote and contractor values');
SELECT is(jsonb_array_length(public.rental_calendar_repair('ca710000-0000-4000-8000-000000000002')->'jobs'),0,'tenant exact selection cannot open another request on their property');
SELECT ok(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000006') IS NOT NULL,'published own-request repair is visible without a lease on that property');
SELECT ok(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000002') IS NULL AND pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000003') IS NULL,'tenant cannot see another request or unpublished maintenance');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'kind'='repair' AND (e->>'amount' IS NOT NULL OR e->>'paid_amount' IS NOT NULL)),'tenant repair deadlines do not disclose costs');
SELECT ok(current_setting('test.calendar') NOT LIKE '%CALENDAR_MANAGER_NAME%' AND current_setting('test.calendar') NOT LIKE '%INTERNAL_DRAFT_ONLY_PROPERTY%' AND current_setting('test.calendar') NOT LIKE '%INTERNAL_ESTIMATE_SECRET%' AND current_setting('test.calendar') NOT LIKE '%DRAFT_INSPECTION_SECRET%','tenant metadata does not reveal staff, draft-only property, quote or draft contents');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'responsible_id' IS NOT NULL),'tenant-only view has no staff identifiers');
SELECT is(jsonb_array_length(public.rental_calendar('2026-11-01','2026-12-01','Europe/Moscow','ca200000-0000-4000-8000-000000000002')->'events'),0,'guessed foreign property filter returns no tenant events');
SELECT is(jsonb_array_length(public.rental_calendar('2026-11-01','2026-12-01','Europe/Moscow',NULL,'00000000-0000-0000-0000-000000000000')->'events'),jsonb_array_length(current_setting('test.calendar')::jsonb->'events'),'unidentified responsible filter includes tenant privacy-preserving events');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000003","role":"authenticated","user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01')::text,true);
SELECT ok(EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'kind'='showing' AND e->>'property_id'='ca200000-0000-4000-8000-000000000001'),'scoped manager sees operational showings');
SELECT is((public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')->>'operator')::boolean,true,'scoped manager can open a selected operational application');
SELECT is((public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')->>'owner')::boolean,false,'manager selected application does not claim owner authority');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000002') IS NULL,'manager direct selection stays within granted properties');
SELECT ok(EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'kind'='payment' AND e->>'property_id'='ca200000-0000-4000-8000-000000000003'),'manager personal tenancy still supplies their own financial events');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'kind'='payment' AND e->>'property_id'='ca200000-0000-4000-8000-000000000001'),'team membership and forged metadata do not grant managed payments');
SELECT is(pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000001')->>'date','2026-11-03','manager receives lease boundary rather than protected inspection date');
SELECT is(pg_temp.calendar_event('move_out','ca400000-0000-4000-8000-000000000001')->>'date','2026-11-25','manager cannot infer submitted handover date');
SELECT is(pg_temp.calendar_event('move_out','ca400000-0000-4000-8000-000000000001')->>'status','planned','team handover status remains a generic plan');
SELECT ok(current_setting('test.calendar') NOT LIKE '%UNSELECTED_REPAIR_SECRET%' AND current_setting('test.calendar') NOT LIKE '%INTERNAL_DRAFT_ONLY_PROPERTY%' AND current_setting('test.calendar') NOT LIKE '%CANDIDATE_INTERNAL_PROPERTY_SECRET%','manager scope excludes same-owner unselected and foreign properties');
SELECT ok(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000003') IS NOT NULL,'manager can see an internal draft work deadline');
SELECT is(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000001')->>'access','team','repair action receives operational access');
SELECT is(pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000004')->>'access','tenant','mixed role retains personal handover access on a different property');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01')::text,true);
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'kind'='payment'),'viewer cannot see property payments');
SELECT is((SELECT count(*) FROM pg_temp.calendar_events() e WHERE e->>'kind'='showing'),1::bigint,'viewer who is also a candidate receives only their own showing');
SELECT is(pg_temp.calendar_event('showing','ca810000-0000-4000-8000-000000000004')->>'access','tenant','same-property viewer/candidate uses personal showing capability');
SELECT is(pg_temp.calendar_event('showing','ca810000-0000-4000-8000-000000000004')->>'responsible_id','ca100000-0000-4000-8000-000000000003','existing same-property team access permits responsible identity');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000001') IS NULL,'viewer cannot use direct selection to inspect another candidate');
SELECT is((public.rental_calendar_application('ca810000-0000-4000-8000-000000000004')->>'operator')::boolean,false,'viewer may open their own application without operational authority');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000004')->'application'->>'operator_note' IS NULL,'viewer personal application hides internal notes');
SELECT ok(EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'kind'='repair'),'viewer still receives permitted repair dates');
SELECT is(public.rental_calendar_repair('ca710000-0000-4000-8000-000000000001')->'jobs'->0->>'id','ca710000-0000-4000-8000-000000000001','viewer can read exact repair on the granted property');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'property_id'<>'ca200000-0000-4000-8000-000000000001'),'viewer events stay within granted property');
SELECT ok(current_setting('test.calendar') NOT LIKE '%CALENDAR_CANDIDATE_NAME%' AND current_setting('test.calendar') NOT LIKE '%CANDIDATE_CONTACT_SECRET%' AND current_setting('test.calendar') NOT LIKE '%OPERATOR_NOTE_SECRET%','viewer projection contains no candidate data');
SELECT is(pg_temp.calendar_event('move_in','ca400000-0000-4000-8000-000000000001')->>'status','planned','viewer cannot infer draft handover state');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000007","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01')::text,true);
SELECT is(jsonb_array_length(current_setting('test.calendar')::jsonb->'events'),1,'candidate has only their own Moscow-range showing');
SELECT is(jsonb_array_length(public.rental_calendar_repair('ca710000-0000-4000-8000-000000000001')->'jobs'),0,'candidate showing does not confer repair context access');
SELECT is((public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')->>'operator')::boolean,false,'own candidate selected application is not an operational view');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')->'application'->>'operator_note' IS NULL AND public.rental_calendar_application('ca810000-0000-4000-8000-000000000001')->'application'->>'agreement_id' IS NULL,'candidate selection preserves existing internal-field redaction');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000003') IS NULL,'candidate cannot select another application on the same listing');
SELECT is(pg_temp.calendar_event('showing','ca810000-0000-4000-8000-000000000001')->>'id','showing:ca810000-0000-4000-8000-000000000001','showing action carries exact application reference');
SELECT ok(pg_temp.calendar_event('showing','ca810000-0000-4000-8000-000000000002') IS NULL,'exclusive range end excludes showing at next local date');
SELECT is(jsonb_array_length(public.rental_calendar('2026-11-01','2026-12-01','UTC')->'events'),2,'same instant is included when selected UTC date is still November');
SELECT is((SELECT p->>'name' FROM jsonb_array_elements(current_setting('test.calendar')::jsonb->'properties') p WHERE p->>'id'='ca200000-0000-4000-8000-000000000001'),'Public selected home','candidate property uses public offer title');
SELECT ok(current_setting('test.calendar') NOT LIKE '%CALENDAR_INTERNAL_PROPERTY%' AND current_setting('test.calendar') NOT LIKE '%CANDIDATE_INTERNAL_PROPERTY_SECRET%' AND current_setting('test.calendar') NOT LIKE '%CALENDAR_MANAGER_NAME%' AND current_setting('test.calendar') NOT LIKE '%OTHER_OWNER_NAME%' AND current_setting('test.calendar') NOT LIKE '%OPERATOR_NOTE_SECRET%','candidate response does not reveal internal property, team or owner identity');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'responsible_id' IS NOT NULL OR e->>'amount' IS NOT NULL OR e->>'paid_amount' IS NOT NULL),'candidate showing has neither financial amounts nor staff ids');
SELECT is(jsonb_array_length(public.rental_calendar('2026-11-01','2026-12-01','Europe/Moscow',NULL,'ca100000-0000-4000-8000-000000000003')->'events'),0,'candidate cannot discover manager assignment through responsible filter');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000009","role":"authenticated","user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01')::text,true);
SELECT is(jsonb_array_length(current_setting('test.calendar')::jsonb->'events'),0,'unrelated user and forged app metadata yield no events');
SELECT is(jsonb_array_length(current_setting('test.calendar')::jsonb->'properties'),0,'unrelated user receives no dropdown metadata');
SELECT is(jsonb_array_length(public.rental_calendar_repair('ca710000-0000-4000-8000-000000000001')->'jobs'),0,'unrelated user cannot read exact repair context');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000001') IS NULL,'unrelated user direct selection reveals no contact snapshot');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01','Europe/Moscow','ca200000-0000-4000-8000-000000000002')::text,true);
SELECT ok(pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000002') IS NOT NULL,'canonical administrator can read other-owner charge');
SELECT is((public.rental_calendar_application('ca810000-0000-4000-8000-000000000002')->>'owner')::boolean,true,'canonical administrator receives existing owner-side application access');
SELECT is(pg_temp.calendar_event('payment','ca410000-0000-4000-8000-000000000002')->>'access','owner','administrator action uses existing owner-side capability');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'property_id'<>'ca200000-0000-4000-8000-000000000002'),'administrator property filter is applied on the server');
RESET ROLE;

-- More than the response cap on one property must not starve a filtered second
-- property or owner fallback assignment. Fixtures are direct test data only.
INSERT INTO public.repair_jobs(id,owner_id,property_id,title,scheduled_date,due_date,estimate_items,estimated_total,status,published_at)
SELECT ('ca900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'ca100000-0000-4000-8000-000000000001'::uuid,'ca200000-0000-4000-8000-000000000001'::uuid,
 'Bulk calendar test '||n,'2026-11-08'::date,'2026-11-09'::date,'[]'::jsonb,1,'approved',now()
FROM generate_series(1,1001) AS n;
SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01')::text,true);
SELECT is(jsonb_array_length(current_setting('test.calendar')::jsonb->'events'),1000,'unfiltered event response has a bounded cap');
SELECT is((current_setting('test.calendar')::jsonb->>'truncated')::boolean,true,'overflow is explicit rather than silently incomplete');
SELECT set_config('test.calendar_selected_repair',public.rental_calendar_repair('ca710000-0000-4000-8000-000000000001')::text,true);
SELECT ok(jsonb_array_length(current_setting('test.calendar_selected_repair')::jsonb->'jobs')=1
 AND current_setting('test.calendar_selected_repair')::jsonb->'jobs'->0->>'id'='ca710000-0000-4000-8000-000000000001'
 AND NOT (current_setting('test.calendar_selected_repair')::jsonb->>'jobs_truncated')::boolean,
 'exact repair selection still returns the older requested job after 1001 newer jobs');
SELECT set_config('test.calendar_properties',(current_setting('test.calendar')::jsonb->'properties')::text,true);
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01','Europe/Moscow','ca200000-0000-4000-8000-000000000002')::text,true);
SELECT ok(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000004') IS NOT NULL,'property filter happens before event cap');
SELECT is((current_setting('test.calendar')::jsonb->>'truncated')::boolean,false,'small filtered result clears truncation');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'property_id'<>'ca200000-0000-4000-8000-000000000002'),'property filtered events contain only the selected property');
SELECT is(current_setting('test.calendar')::jsonb->'properties',current_setting('test.calendar_properties')::jsonb,'property options do not disappear when events are filtered');
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01','Europe/Moscow',NULL,'ca100000-0000-4000-8000-000000000001')::text,true);
SELECT ok(pg_temp.calendar_event('repair','ca710000-0000-4000-8000-000000000004') IS NOT NULL,'responsible filter happens before event cap');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'responsible_id'<>'ca100000-0000-4000-8000-000000000001'),'responsible filtered response excludes assigned manager events');
SELECT is((current_setting('test.calendar')::jsonb->>'truncated')::boolean,false,'responsible filter reports its own completeness');
RESET ROLE;

UPDATE public.team_memberships SET status='revoked' WHERE id='ca500000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01')::text,true);
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'property_id'='ca200000-0000-4000-8000-000000000001'),'revoked manager loses operational events immediately');
SELECT is(jsonb_array_length(public.rental_calendar_repair('ca710000-0000-4000-8000-000000000001')->'jobs'),0,'revoked manager cannot recover a repair through its exact id');
SELECT ok(public.rental_calendar_application('ca810000-0000-4000-8000-000000000001') IS NULL,'revoked manager also loses direct application selection');
SELECT ok(EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'kind'='payment' AND e->>'property_id'='ca200000-0000-4000-8000-000000000003'),'revocation does not erase independent personal tenancy rights');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_setting('test.calendar')::jsonb->'properties') p WHERE p->>'id'='ca200000-0000-4000-8000-000000000001'),'revocation removes property metadata as well');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ca100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.calendar',public.rental_calendar('2026-11-01','2026-12-01','Europe/Moscow','ca200000-0000-4000-8000-000000000001','ca100000-0000-4000-8000-000000000001')::text,true);
SELECT ok(jsonb_array_length(current_setting('test.calendar')::jsonb->'events')>0,'revoked responsible assignment falls back to the owner');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_temp.calendar_events() e WHERE e->>'responsible_id'='ca100000-0000-4000-8000-000000000003'),'inactive manager is never returned as a current responsible');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
