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

SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT has_table_privilege('authenticated','public.lease_handovers','INSERT,UPDATE,DELETE'),'report writes require validated RPC');
SELECT ok(NOT has_table_privilege('authenticated','public.lease_handover_events','INSERT,UPDATE,DELETE'),'history is append-only for clients');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.lease_handovers'::regclass,'public.lease_handover_events'::regclass)),'RLS is enabled on both exposed tables');
SELECT ok((SELECT NOT prosecdef FROM pg_proc WHERE oid='public.act_on_lease_handover(uuid,text,integer,text)'::regprocedure),'public RPC runs as caller, privileged implementation stays private');
SELECT lives_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_in',pg_temp.payload(),NULL) $$,'owner prepares move-in act');
SELECT is((SELECT inventory_snapshot->0->>'name' FROM public.lease_handovers),'Sofa','inventory is snapshotted server-side');
SELECT set_config('test.move_in_id',(SELECT id::text FROM public.lease_handovers),true);
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_in',pg_temp.payload(),NULL) $$,'40001','Акт изменился. Обновите данные и повторите действие','parallel creation cannot replace an existing report');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_in_id')::uuid,'confirm',1,NULL) $$,'42501','Это действие доступно другой стороне договора','owner cannot confirm own act');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_in_id')::uuid,'submit',1,NULL) $$,'owner submits move-in act');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.lease_handovers),1::bigint,'tenant sees submitted move-in act');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_in_id')::uuid,'confirm',2,NULL) $$,'tenant confirms move-in act');
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload(),NULL) $$,'42501','Нет доступа к акту','tenant cannot forge an owner inspection');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"deposit_received":"NaN"}',NULL) $$,'23514','Укажите полученный депозит с точностью до копеек','non-finite deposits are rejected');
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"deductions":[{"reason":"Damage","amount":30001}]}',NULL) $$,'23514','Удержания доступны при выезде и не могут превышать депозит','deductions cannot exceed the deposit');
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"deductions":[{"reason":" ","amount":100}]}',NULL) $$,'23514','Для удержания укажите причину и положительную сумму до копеек','deductions require a reason');
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"photos":["foreign/photo.png"]}',NULL) $$,'42501','Фотографии должны быть загружены вами для этого осмотра','forged photographs are rejected');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('lease-handover-photos','81000000-0000-0000-0000-000000000001/84000000-0000-0000-0000-000000000001/move_out/room.png','81000000-0000-0000-0000-000000000001');
SELECT lives_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"deductions":[{"reason":"Table scratch","amount":2500.25}],"photos":["81000000-0000-0000-0000-000000000001/84000000-0000-0000-0000-000000000001/move_out/room.png"],"refund_due":1}',NULL) $$,'owner saves photographed move-out act');
SELECT set_config('test.move_out_id',(SELECT id::text FROM public.lease_handovers WHERE kind='move_out'),true);
SELECT is((SELECT refund_due FROM public.lease_handovers WHERE kind='move_out'),27499.75::numeric,'server computes refund and ignores forged totals');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'mark_refunded',1,NULL) $$,'23514','Сначала согласуйте акт выезда с арендатором','refund cannot be marked before agreement');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'submit',0,NULL) $$,'40001','Акт изменился. Обновите данные и повторите действие','stale versions cannot publish');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.lease_handovers WHERE kind='move_out'),0::bigint,'tenant cannot see the owner draft');
SELECT is((SELECT count(*) FROM public.lease_handover_events WHERE handover_id=current_setting('test.move_out_id')::uuid),0::bigint,'draft history is private');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='lease-handover-photos'),0::bigint,'draft photos are private');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'submit',1,NULL) $$,'owner submits move-out act');
SELECT throws_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload(),2) $$,'23514','Отправленный или подтверждённый акт нельзя изменять','published act is immutable until decision');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.lease_handovers),0::bigint,'unrelated owner sees no inspections');
SELECT is((SELECT count(*) FROM public.lease_handover_events),0::bigint,'unrelated owner sees no history');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='lease-handover-photos'),0::bigint,'unrelated owner sees no photos');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'complete',2,NULL) $$,'42501','Нет доступа к акту','unrelated owner cannot act on guessed ID');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='lease-handover-photos'),1::bigint,'tenant sees submitted photographic evidence');
SELECT throws_ok($$ UPDATE public.lease_handovers SET deposit_received=1 $$,'42501','permission denied for table lease_handovers','tenant cannot forge refund totals');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'dispute',2,' ') $$,'23514','Опишите замечания к акту','dispute requires an explanation');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'dispute',2,'Scratch was already present') $$,'tenant disputes the deductions');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'confirm',2,NULL) $$,'40001','Акт изменился. Обновите данные и повторите действие','a second decision cannot overwrite the first');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.save_lease_handover('84000000-0000-0000-0000-000000000001','move_out',pg_temp.payload() || '{"deductions":[{"reason":"Cleaning","amount":1000.10}]}',3) $$,'owner prepares a corrected version');
SELECT is((SELECT snapshot->'deductions'->0->>'reason' FROM public.lease_handover_events WHERE handover_id=current_setting('test.move_out_id')::uuid AND event_type='submitted'),'Table scratch','previous published version is retained');
DELETE FROM storage.objects WHERE bucket_id='lease-handover-photos';
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='lease-handover-photos'),1::bigint,'photos attached to an earlier revision cannot be deleted');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'submit',4,NULL) $$,'owner republishes the corrected version');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'confirm',5,NULL) $$,'tenant confirms corrected act');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='lease-handover-photos'),1::bigint,'tenant can still read evidence attached to a previous published revision');
SELECT is((SELECT refund_due FROM public.lease_handovers WHERE kind='move_out'),28999.90::numeric,'agreed refund uses exact kopecks');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'confirm_refund',6,NULL) $$,'23514','Собственник ещё не отметил возврат','tenant cannot acknowledge a return that has not been marked');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'complete',6,NULL) $$,'42501','Это действие доступно другой стороне договора','only the owner completes the lease');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ INSERT INTO public.rent_payments(charge_id,owner_id,tenant_id,amount,paid_at,payment_method)
  SELECT id,owner_id,tenant_id,100,now(),'cash' FROM public.rent_charges WHERE period_start>date_trunc('month',CURRENT_DATE)::date ORDER BY period_start LIMIT 1 $$,'fixture records advance payment on a future period');
RESET ROLE;
INSERT INTO public.utility_bills(agreement_id,period_start,status,amount,submitted_by)
VALUES('84000000-0000-0000-0000-000000000001',date_trunc('month',CURRENT_DATE)::date,'pending',0,'81000000-0000-0000-0000-000000000002');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'complete',6,NULL) $$,'23514','Сначала проверьте отправленные коммунальные показания','pending utility review must be settled before closure');
RESET ROLE;
DELETE FROM public.utility_bills WHERE agreement_id='84000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'complete',6,NULL) $$,'owner completes the rental');
SELECT is((SELECT status FROM public.lease_agreements WHERE id='84000000-0000-0000-0000-000000000001'),'completed','lease status is completed');
SELECT is((SELECT end_date FROM public.lease_agreements WHERE id='84000000-0000-0000-0000-000000000001'),CURRENT_DATE,'lease ends on inspection date');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE period_start=date_trunc('month',CURRENT_DATE)::date),1::bigint,'current unpaid rent is preserved');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE period_start<date_trunc('month',CURRENT_DATE)::date),1::bigint,'past debt is preserved');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE period_start>date_trunc('month',CURRENT_DATE)::date AND paid_amount=0),0::bigint,'future unpaid rent is removed');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE period_start>date_trunc('month',CURRENT_DATE)::date AND paid_amount=100),1::bigint,'future payments and their charge remain in financial history');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'complete',6,NULL) $$,'retrying completion is idempotent');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'mark_refunded',7,NULL) $$,'owner marks a real return separately');
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'mark_refunded',7,NULL) $$,'retrying return is idempotent');
SELECT is((SELECT count(*) FROM public.lease_handover_events WHERE event_type='refund_marked'),1::bigint,'return is recorded once');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'confirm_refund',8,NULL) $$,'tenant acknowledges actual receipt');
SELECT ok((SELECT refund_confirmed_at IS NOT NULL FROM public.lease_handovers WHERE kind='move_out'),'receipt acknowledgement is stored');
SELECT ok((SELECT count(*) > 0 FROM public.notifications WHERE kind='handover_status'),'participants receive handover notifications');

RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM public.lease_handovers $$,'42501','permission denied for table lease_handovers','anonymous users cannot read inspections');
SELECT throws_ok($$ SELECT public.act_on_lease_handover(current_setting('test.move_out_id')::uuid,'complete',9,NULL) $$,'42501','permission denied for function act_on_lease_handover','anonymous users cannot act');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
