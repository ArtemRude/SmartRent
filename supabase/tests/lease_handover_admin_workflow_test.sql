BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();
INSERT INTO auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('81000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','handover-owner@example.invalid','{"provider":"email"}','{"role":"owner"}',now(),now()),
('81000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','handover-tenant@example.invalid','{"provider":"email"}','{"role":"tenant"}',now(),now()),
('81000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','handover-stranger@example.invalid','{"provider":"email"}','{"role":"owner"}',now(),now());
INSERT INTO public.properties(id,owner_id,name,address) VALUES('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','Handover apartment','Test address');
INSERT INTO public.tenants(id,owner_id,user_id,name,email) VALUES('83000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002','Handover Tenant','handover-tenant@example.invalid');
INSERT INTO public.lease_agreements(id,owner_id,property_id,tenant_id,start_date,end_date,monthly_payment,status,signed_document_file,contract_details)
VALUES('84000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001',
  (date_trunc('month',CURRENT_DATE)-interval '1 month')::date,(CURRENT_DATE+interval '3 months')::date,30000,'active','test/signed.pdf','{"depositAmount":30000,"inventoryItems":[{"name":"Sofa","quantity":"1","condition":"Good"}]}');
CREATE FUNCTION pg_temp.payload() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
  'inspection_date',CURRENT_DATE,'keys_count',2,'checklist','{"condition":true,"inventory":true,"meters":true,"keys":true}'::jsonb,
  'condition_note','Inspected, small scratch on table','meter_readings','Water 103.2; power 1250','deposit_received',30000,'deductions','[]'::jsonb,'photos','[]'::jsonb) $$;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('81000000-0000-0000-0000-000000000004','handover-admin@example.invalid','{"role":"owner"}');
UPDATE public.user_roles SET role='admin' WHERE user_id='81000000-0000-0000-0000-000000000004';
-- User-editable metadata must never grant administrative access.
UPDATE auth.users SET raw_user_meta_data='{"role":"admin"}' WHERE id='81000000-0000-0000-0000-000000000003';
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated","user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT private.handover_access('84000000-0000-0000-0000-000000000001',true),'forged admin metadata grants no management access');
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_in',pg_temp.payload(),NULL) $$,'42501','Нет доступа к акту','unrelated owner cannot create an act');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('lease-handover-photos','81000000-0000-0000-0000-000000000001/84000000-0000-0000-0000-000000000001/move_in/owner.png','81000000-0000-0000-0000-000000000001');
SELECT lives_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_in',pg_temp.payload() || '{"photos":["81000000-0000-0000-0000-000000000001/84000000-0000-0000-0000-000000000001/move_in/owner.png"]}',NULL) $$,'owner creates photographed move-in draft');
SELECT set_config('test.move_in_id',(SELECT id::text FROM public.lease_handovers WHERE kind='move_in'),true);
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok(private.handover_access('84000000-0000-0000-0000-000000000001',true),'DB administrator can manage another owner lease');
SELECT is((SELECT count(*) FROM public.lease_handovers),1::bigint,'admin sees owner drafts');
SELECT is((SELECT count(*) FROM public.lease_handover_events),1::bigint,'admin sees draft history');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='lease-handover-photos'),1::bigint,'admin sees the owner attached evidence');
SELECT lives_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_in',pg_temp.payload() || '{"photos":["81000000-0000-0000-0000-000000000001/84000000-0000-0000-0000-000000000001/move_in/owner.png"]}',1) $$,'admin retains evidence attached by owner while editing');
SELECT is((SELECT actor_id FROM public.lease_handover_events ORDER BY created_at DESC,id DESC LIMIT 1) IS NOT NULL,true,'audit records the actor');
SELECT is((SELECT count(*) FROM public.lease_handover_events WHERE actor_id=auth.uid()),1::bigint,'admin is recorded as actual actor, not impersonated owner');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_in_id')::uuid,'confirm',2,NULL) $$,'42501','Это действие доступно другой стороне договора','admin cannot approve for tenant');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_in_id')::uuid,'submit',2,NULL) $$,'admin submits move-in');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_in_id')::uuid,'confirm',3,NULL) $$,'tenant confirms admin-prepared move-in');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"photos":["81000000-0000-0000-0000-000000000001/84000000-0000-0000-0000-000000000001/move_in/owner.png"]}',NULL) $$,'42501','Фотографии должны быть загружены вами для этого осмотра','photo from another act cannot be attached as new evidence');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('lease-handover-photos','81000000-0000-0000-0000-000000000004/84000000-0000-0000-0000-000000000001/move_out/admin.png','81000000-0000-0000-0000-000000000004');
SELECT lives_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"photos":["81000000-0000-0000-0000-000000000004/84000000-0000-0000-0000-000000000001/move_out/admin.png"]}',NULL) $$,'admin uploads own evidence and creates move-out');
SELECT set_config('test.move_out_id',(SELECT id::text FROM public.lease_handovers WHERE kind='move_out'),true);
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"photos":["81000000-0000-0000-0000-000000000004/84000000-0000-0000-0000-000000000001/move_out/admin.png"]}',1) $$,'owner can edit admin draft without losing attached evidence');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'submit',1,NULL) $$,'40001','Акт изменился. Обновите данные и повторите действие','admin also obeys optimistic concurrency');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'submit',2,NULL) $$,'admin submits owner-revised move-out');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'dispute',3,'Test') $$,'42501','Это действие доступно другой стороне договора','admin cannot dispute for tenant');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'confirm',3,NULL) $$,'tenant confirms move-out');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'complete',4,NULL) $$,'admin completes rental after tenant approval');
SELECT is((SELECT status FROM public.lease_agreements WHERE id='84000000-0000-0000-0000-000000000001'),'completed','rental is completed');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'mark_refunded',5,NULL) $$,'admin marks actual refund');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'confirm_refund',6,NULL) $$,'42501','Это действие доступно другой стороне договора','admin cannot acknowledge money on behalf of tenant');
SELECT ok((SELECT refund_confirmed_at IS NULL FROM public.lease_handovers WHERE kind='move_out'),'receipt remains unconfirmed until tenant acts');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'confirm_refund',6,NULL) $$,'tenant acknowledges refund');
RESET ROLE;
UPDATE public.user_roles SET role='owner' WHERE user_id='81000000-0000-0000-0000-000000000004';
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.lease_handovers),0::bigint,'revoking admin removes access to another owner acts');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'mark_refunded',6,NULL) $$,'42501','Нет доступа к акту','revoked admin cannot replay privileged actions');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
