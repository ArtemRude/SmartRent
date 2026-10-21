BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('e1000000-0000-0000-0000-000000000001','repair-owner@example.invalid',now(),'{"name":"Owner","role":"owner"}'),
 ('e1000000-0000-0000-0000-000000000002','repair-other@example.invalid',now(),'{"name":"Other","role":"owner"}'),
 ('e1000000-0000-0000-0000-000000000003','repair-manager@example.invalid',now(),'{"name":"Manager","role":"owner"}'),
 ('e1000000-0000-0000-0000-000000000004','repair-viewer@example.invalid',now(),'{"name":"Viewer","role":"owner"}'),
 ('e1000000-0000-0000-0000-000000000005','repair-tenant@example.invalid',now(),'{"name":"Tenant","role":"tenant"}'),
 ('e1000000-0000-0000-0000-000000000006','repair-admin@example.invalid',now(),'{"name":"Admin","role":"owner"}');
UPDATE public.user_roles SET role='admin' WHERE user_id='e1000000-0000-0000-0000-000000000006';
INSERT INTO public.properties(id,owner_id,name) VALUES
 ('e2000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','Selected'),
 ('e2000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','Not selected'),
 ('e2000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000002','Foreign property');
INSERT INTO public.tenants(id,owner_id,user_id,name) VALUES
 ('e3000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000005','Tenant');
INSERT INTO public.requests(id,owner_id,property_id,tenant_id,title,category) VALUES
 ('e4000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','Tap repair','repair'),
 ('e4000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002','e3000000-0000-0000-0000-000000000001','Unselected repair','repair');
INSERT INTO public.team_memberships(id,owner_id,email,user_id,role,status) VALUES
 ('e5000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','repair-manager@example.invalid','e1000000-0000-0000-0000-000000000003','manager','active'),
 ('e5000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','repair-viewer@example.invalid','e1000000-0000-0000-0000-000000000004','viewer','active');
INSERT INTO public.team_property_access VALUES
 ('e5000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001'),
 ('e5000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000001');
SELECT set_config('test.repair_values',jsonb_build_object('title','Fix tap','description','Replace valve','request_id','e4000000-0000-0000-0000-000000000001','scheduled_date',CURRENT_DATE,'due_date',CURRENT_DATE+3,
 'estimate_items',jsonb_build_array(jsonb_build_object('name','Labour','quantity',1.5,'unit_price',100.11)))::text,true);
CREATE FUNCTION pg_temp.repair_rev() RETURNS integer LANGUAGE sql AS $$
 SELECT (j->>'revision')::integer FROM jsonb_array_elements(public.repairs_overview()->'jobs') j WHERE j->>'id'=current_setting('test.repair_job');
$$;
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.repair_jobs'::regclass,'public.repair_contractors'::regclass,'public.repair_events'::regclass)),'repair tables enable RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.repair_jobs','SELECT,INSERT,UPDATE,DELETE'),'jobs have no raw browser access');
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.repair_contractor',public.save_repair_contractor('e1000000-0000-0000-0000-000000000001',NULL,'{"name":"Master","phone":"SECRET_CONTACT","note":"PRIVATE_DIRECTORY_NOTE"}',NULL)::text,true);
SELECT throws_ok($$SELECT public.save_repair_contractor('e1000000-0000-0000-0000-000000000002',NULL,'{"name":"Stolen"}',NULL)$$,'42501',NULL,'owner cannot create another owner contractor');
SELECT set_config('test.repair_values',(current_setting('test.repair_values')::jsonb||jsonb_build_object('contractor_id',current_setting('test.repair_contractor')))::text,true);
SELECT set_config('test.repair_job',public.save_repair_job('e2000000-0000-0000-0000-000000000001',NULL,current_setting('test.repair_values')::jsonb,NULL)::text,true);
SELECT public.save_repair_job('e2000000-0000-0000-0000-000000000002',NULL,current_setting('test.repair_values')::jsonb||'{"request_id":null,"title":"UNSELECTED_JOB_SECRET"}',NULL);
SELECT throws_ok($$SELECT public.save_repair_job('e2000000-0000-0000-0000-000000000001',NULL,current_setting('test.repair_values')::jsonb,NULL)$$,'23505',NULL,'request cannot create duplicate open or completed jobs');
SELECT throws_ok($$SELECT public.save_repair_job('e2000000-0000-0000-0000-000000000003',NULL,current_setting('test.repair_values')::jsonb,NULL)$$,'42501',NULL,'foreign property denied');
SELECT throws_ok($$SELECT public.save_repair_job('e2000000-0000-0000-0000-000000000001',current_setting('test.repair_job')::uuid,current_setting('test.repair_values')::jsonb,99)$$,'40001',NULL,'stale quote cannot overwrite');
RESET ROLE;
SELECT is((SELECT estimated_total FROM public.repair_jobs WHERE id=current_setting('test.repair_job')::uuid),150.17::numeric,'each estimate line rounds to kopecks on the server');
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.repairs_overview()->'jobs'),0,'tenant cannot see unpublished quote');
SELECT throws_ok($$SELECT * FROM public.repair_contractors$$,'42501',NULL,'tenant cannot read directory through table');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated","user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.repairs_overview()->'contractors'),0,'manager cannot browse owner contractor directory');
SELECT ok(public.repairs_overview()::text NOT LIKE '%UNSELECTED_JOB_SECRET%','manager sees repairs only on granted properties');
SELECT ok(public.repairs_overview()::text LIKE '%SECRET_CONTACT%' AND public.repairs_overview()::text NOT LIKE '%PRIVATE_DIRECTORY_NOTE%','assigned contractor contact is scoped to job without private directory notes');
SELECT throws_ok($$SELECT public.save_repair_contractor('e1000000-0000-0000-0000-000000000001',NULL,'{"name":"Manager tries"}',NULL)$$,'42501',NULL,'manager cannot edit contractor directory');
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'start',pg_temp.repair_rev())$$,'23514',NULL,'work cannot start before quote approval');
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'submit',pg_temp.repair_rev())$$,'manager submits owner assigned draft');
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'approve',pg_temp.repair_rev())$$,'42501',NULL,'metadata does not let manager approve budget');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'reject',pg_temp.repair_rev())$$,'23514',NULL,'quote rejection needs reason');
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'reject',pg_temp.repair_rev(),'{"note":"Clarify materials"}')$$,'owner returns quote');
SELECT lives_ok($$SELECT public.save_repair_job('e2000000-0000-0000-0000-000000000001',current_setting('test.repair_job')::uuid,current_setting('test.repair_values')::jsonb,pg_temp.repair_rev())$$,'draft can be resaved with a new revision');
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'submit',pg_temp.repair_rev())$$,'quote resubmitted');
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'approve',pg_temp.repair_rev())$$,'owner approves quote');
SELECT throws_ok($$SELECT public.save_repair_job('e2000000-0000-0000-0000-000000000001',current_setting('test.repair_job')::uuid,current_setting('test.repair_values')::jsonb,pg_temp.repair_rev())$$,'23514',NULL,'approved budget cannot be silently changed');
SELECT throws_ok($$UPDATE public.requests SET status='closed' WHERE id='e4000000-0000-0000-0000-000000000001'$$,'23514',NULL,'old request control cannot bypass repair acceptance');
SELECT lives_ok($$DO $block$ BEGIN
  BEGIN
    DELETE FROM public.requests WHERE id='e4000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Linked request was deleted';
  EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL;
  END;
END $block$;$$,'linked request cannot delete repair history through a cascade');
SELECT throws_ok($$UPDATE public.properties SET owner_id='e1000000-0000-0000-0000-000000000002' WHERE id='e2000000-0000-0000-0000-000000000001'$$,'23514',NULL,'property ownership transfer cannot expose contractor history to a new owner');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.repairs_overview()->'jobs'),1,'tenant sees published own repair');
SELECT ok(public.repairs_overview()::text NOT LIKE '%SECRET_CONTACT%' AND public.repairs_overview()::text NOT LIKE '%150.17%' AND jsonb_array_length(public.repairs_overview()->'events')=0,'tenant snapshot hides costs contacts and internal history');
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'start',6)$$,'42501',NULL,'tenant cannot manage repair');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.repairs_overview()->'jobs'),1,'viewer reads selected property repair');
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'start',pg_temp.repair_rev())$$,'42501',NULL,'viewer cannot start work');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'start',pg_temp.repair_rev())$$,'manager starts approved job');
SELECT set_config('test.repair_photo','e1000000-0000-0000-0000-000000000003/'||current_setting('test.repair_job')||'/result.png',true);
SELECT lives_ok($$INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('repair-result-photos',current_setting('test.repair_photo'),'e1000000-0000-0000-0000-000000000003')$$,'manager uploads result to scoped private bucket');
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'report',pg_temp.repair_rev(),'{"actual_amount":200,"note":"Done","photos":[]}')$$,'22023',NULL,'report requires result photo');
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'report',pg_temp.repair_rev(),'{"actual_amount":200,"note":"Done","photos":["other/job/forged.png"]}')$$,'42501',NULL,'cannot attach another job photo');
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'report',pg_temp.repair_rev(),jsonb_build_object('actual_amount',200,'note','Done','photos',jsonb_build_array(current_setting('test.repair_photo'))))$$,'manager reports actual cost for owner review');
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'accept',pg_temp.repair_rev())$$,'42501',NULL,'manager cannot accept own work');
SELECT lives_ok($$DELETE FROM storage.objects WHERE name=current_setting('test.repair_photo')$$,'referenced photo delete is filtered');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM storage.objects WHERE name=current_setting('test.repair_photo')),'referenced result remains in private storage');
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'accept',pg_temp.repair_rev())$$,'23514',NULL,'overrun requires explicit owner explanation');
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'return',pg_temp.repair_rev(),'{"note":"Finish cleanup"}')$$,'owner can request rework');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'report',pg_temp.repair_rev(),jsonb_build_object('actual_amount',200,'note','Cleanup done','photos',jsonb_build_array(current_setting('test.repair_photo'))))$$,'previous same job photo can be retained for reworked report');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'accept',pg_temp.repair_rev(),'{"note":"Additional materials approved"}')$$,'owner accepts documented overrun');
SELECT set_config('test.repair_expense',public.act_on_repair_job(current_setting('test.repair_job')::uuid,'expense',pg_temp.repair_rev())::text,true);
SELECT is(public.act_on_repair_job(current_setting('test.repair_job')::uuid,'expense',0),current_setting('test.repair_expense')::uuid,'repeated expense action returns same expense even from stale tab');
RESET ROLE;
SELECT is((SELECT status FROM public.requests WHERE id='e4000000-0000-0000-0000-000000000001'),'closed'::public.request_status,'accepted repair closes canonical request');
SELECT is((SELECT count(*) FROM public.property_expenses WHERE id=current_setting('test.repair_expense')::uuid),1::bigint,'exactly one linked expense created');
SELECT is((SELECT status FROM public.property_expenses WHERE id=current_setting('test.repair_expense')::uuid),'planned','completion never records a payment');
SELECT is((SELECT planned_amount FROM public.property_expenses WHERE id=current_setting('test.repair_expense')::uuid),200::numeric,'expense uses final owner accepted cost');
SELECT ok((SELECT bool_and(actor_id IS NOT NULL) FROM public.repair_events WHERE job_id=current_setting('test.repair_job')::uuid),'audit stores actual actors');
SELECT ok(EXISTS(SELECT 1 FROM public.repair_events WHERE job_id=current_setting('test.repair_job')::uuid AND snapshot->>'result_note'='Done'),'old returned report remains in immutable audit');
SELECT ok(EXISTS(SELECT 1 FROM public.notifications WHERE user_id='e1000000-0000-0000-0000-000000000005' AND kind='repair_status'),'tenant notified without cost details');
SELECT set_config('test.maintenance_job',public.save_repair_job('e2000000-0000-0000-0000-000000000001',NULL,current_setting('test.repair_values')::jsonb||'{"request_id":null,"title":"INTERNAL_MAINTENANCE_SECRET"}',NULL)::text,true);
SELECT public.act_on_repair_job(current_setting('test.maintenance_job')::uuid,'submit',1);
SELECT public.act_on_repair_job(current_setting('test.maintenance_job')::uuid,'approve',2);
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok(public.repairs_overview()::text NOT LIKE '%INTERNAL_MAINTENANCE_SECRET%','tenant own property access does not reveal unrelated published maintenance');
SELECT ok(EXISTS(SELECT 1 FROM storage.objects WHERE name=current_setting('test.repair_photo')),'tenant may read accepted result photo');
RESET ROLE;
UPDATE public.team_memberships SET status='revoked' WHERE id='e5000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.repairs_overview()->'jobs'),0,'revoked manager loses repair snapshot');
SELECT is((SELECT count(*) FROM storage.objects WHERE name=current_setting('test.repair_photo')),0::bigint,'revocation blocks new reads of result photo');
SELECT throws_ok($$SELECT public.act_on_repair_job(current_setting('test.repair_job')::uuid,'expense',0)$$,'42501',NULL,'idempotence cannot bypass current access');
SELECT throws_ok($$DELETE FROM public.repair_events$$,'42501',NULL,'cannot erase repair history');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.repairs_overview()$$,'42501',NULL,'anonymous cannot read repair snapshot');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
