BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'utility-owner@example.invalid', '{"provider":"email"}', '{"name":"Utility Owner","role":"owner"}', now(), now()),
('91000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'utility-tenant@example.invalid', '{"provider":"email"}', '{"name":"Utility Tenant","role":"tenant"}', now(), now()),
('91000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'utility-outsider@example.invalid', '{"provider":"email"}', '{"name":"Utility Outsider","role":"owner"}', now(), now());
INSERT INTO public.properties(id, owner_id, name, address)
VALUES ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'Utility test apartment', 'Test address');
INSERT INTO public.tenants(id, owner_id, user_id, name, email)
VALUES ('93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', 'Utility Tenant', 'utility-tenant@example.invalid');
INSERT INTO public.lease_agreements(id, owner_id, property_id, tenant_id, start_date, end_date, monthly_payment, status, signed_document_file)
VALUES ('94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001',
  (date_trunc('month', CURRENT_DATE) - interval '2 months')::date, (CURRENT_DATE + interval '1 year')::date, 30000, 'active', 'test/signed.pdf');

SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', jsonb_build_object(
  'name','Cold water','kind','meter','unit','m³','rate',42.75,'initial_reading',100,'start_period',(date_trunc('month', CURRENT_DATE)-interval '1 month')::date)) $$,
  'owner configures a meter');
SELECT lives_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', jsonb_build_object(
  'name','Internet','kind','fixed','unit','month','rate',500,'start_period',(date_trunc('month', CURRENT_DATE)-interval '1 month')::date)) $$,
  'owner configures a fixed monthly service');
SELECT is((SELECT count(*) FROM public.utility_services), 2::bigint, 'owner sees both services');
SELECT ok(NOT has_table_privilege('authenticated','public.utility_services','INSERT,UPDATE,DELETE'), 'service writes are restricted to validated RPC');
SELECT ok(NOT has_table_privilege('authenticated','public.utility_bills','INSERT,UPDATE,DELETE'), 'bill writes are restricted to validated RPC');
SELECT ok(NOT has_table_privilege('authenticated','public.utility_bill_items','INSERT,UPDATE,DELETE'), 'item writes are restricted to validated RPC');
SELECT throws_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', jsonb_build_object(
  'name','Invalid','kind','meter','unit','m³','rate',10,'initial_reading','NaN','start_period',date_trunc('month', CURRENT_DATE)::date)) $$,
  '23514', 'Начальные показания указываются с точностью до 0,001', 'non-finite initial readings cannot poison later calculations');
SELECT throws_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', jsonb_build_object(
  'name','Invalid','kind','fixed','unit','month','rate',0.001,'start_period',date_trunc('month', CURRENT_DATE)::date)) $$,
  '23514', 'Проверьте тариф: до 4 знаков после запятой, фиксированный платёж — до 2', 'fixed fees cannot hide fractions of a kopeck');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.utility_services), 0::bigint, 'unrelated owner cannot see services');
SELECT is((SELECT count(*) FROM public.utility_bills), 0::bigint, 'unrelated owner cannot see bills');
SELECT throws_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', 'Нет доступа к настройкам коммунальных услуг', 'unrelated owner cannot configure services');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', date_trunc('month',CURRENT_DATE)::date, '[]') $$,
  '42501', 'Нет доступа к этому договору', 'unrelated owner cannot submit readings');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.utility_services), 2::bigint, 'tenant sees their own services');
SELECT throws_ok($$ UPDATE public.utility_services SET rate=1 $$, '42501', 'permission denied for table utility_services', 'tenant cannot change tariffs directly');
SELECT throws_ok($$ DELETE FROM public.utility_services $$, '42501', 'permission denied for table utility_services', 'tenant cannot delete meters');
SELECT throws_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', '{}') $$,
  '42501', 'Нет доступа к настройкам коммунальных услуг', 'tenant cannot configure services through RPC');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', (date_trunc('month',CURRENT_DATE)+interval '1 month')::date, '[]') $$,
  '23514', 'Выберите прошедший или текущий месяц в пределах договора', 'future-period readings are rejected');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', date_trunc('month',CURRENT_DATE)::date, '[]') $$,
  '23514', 'Передайте показания счётчика «Cold water»', 'missing meter readings are rejected');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', date_trunc('month',CURRENT_DATE)::date,
  (SELECT jsonb_build_array(jsonb_build_object('service_id',id,'reading',99)) FROM public.utility_services WHERE kind='meter')) $$,
  '23514', 'Показания «Cold water» меньше предыдущих (100.000)', 'decreasing readings are rejected server-side');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', date_trunc('month',CURRENT_DATE)::date,
  '[{"service_id":"95000000-0000-0000-0000-000000000001","reading":103.2}]') $$,
  '23514', 'Проверьте список счётчиков', 'unknown meters are rejected');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', date_trunc('month',CURRENT_DATE)::date,
  (SELECT jsonb_build_array(jsonb_build_object('service_id',id,'reading',103.2),jsonb_build_object('service_id',id,'reading',103.2)) FROM public.utility_services WHERE kind='meter')) $$,
  '23514', 'Проверьте список счётчиков', 'duplicate meters are rejected');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', date_trunc('month',CURRENT_DATE)::date,
  (SELECT jsonb_build_array(jsonb_build_object('service_id',id,'reading',103.2,'photo_path','91000000-0000-0000-0000-000000000002/94000000-0000-0000-0000-000000000001/missing.png')) FROM public.utility_services WHERE kind='meter')) $$,
  '42501', 'Фотография должна быть загружена вами для этого договора', 'a forged photo path is rejected');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('utility-reading-photos','91000000-0000-0000-0000-000000000002/94000000-0000-0000-0000-000000000001/meter.png','91000000-0000-0000-0000-000000000002');
SELECT lives_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', (date_trunc('month',CURRENT_DATE)-interval '1 month')::date,
  (SELECT jsonb_build_array(jsonb_build_object('service_id',id,'reading',103.2,'rate',1,'amount',1,'photo_path','91000000-0000-0000-0000-000000000002/94000000-0000-0000-0000-000000000001/meter.png')) FROM public.utility_services WHERE kind='meter')) $$,
  'tenant submits photographed readings');
SELECT is((SELECT amount FROM public.utility_bills WHERE status='pending'), 636.80::numeric, 'server computes usage plus the fixed fee, ignoring forged totals');
SELECT is((SELECT previous_reading FROM public.utility_bill_items WHERE kind='meter'), 100::numeric, 'first bill uses initial reading');
SELECT is((SELECT count(*) FROM public.utility_bill_items), 2::bigint, 'bill snapshots meter and fixed service');
SELECT throws_ok($$ UPDATE public.utility_bills SET status='approved' $$, '42501', 'permission denied for table utility_bills', 'tenant cannot approve by writing the table');
SELECT throws_ok($$ INSERT INTO public.utility_bill_items(bill_id,service_id,name,kind,unit,rate,amount) VALUES (gen_random_uuid(),gen_random_uuid(),'Forged','fixed','month',1,1) $$,
  '42501', 'permission denied for table utility_bill_items', 'tenant cannot forge bill items');
SELECT throws_ok($$ SELECT public.review_utility_bill((SELECT id FROM public.utility_bills WHERE status='pending'),true,NULL,CURRENT_DATE+7) $$,
  '42501', 'Нет доступа к этому расчёту', 'tenant cannot approve through RPC');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001',date_trunc('month',CURRENT_DATE)::date,'[]') $$,
  '23514', 'Предыдущий расчёт ещё ожидает проверки', 'a second pending submission is blocked');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE charge_type='utilities'), 0::bigint, 'pending bill does not create debt');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='utility-reading-photos'), 1::bigint, 'tenant can read their photo');
DELETE FROM storage.objects WHERE bucket_id='utility-reading-photos';
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='utility-reading-photos'), 1::bigint, 'an attached photo cannot be deleted');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.utility_bill_items), 0::bigint, 'unrelated owner cannot see photographed readings');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='utility-reading-photos'), 0::bigint, 'unrelated owner cannot read meter photos');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='utility-reading-photos'), 1::bigint, 'owner can review the tenant photo');
SELECT throws_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', (SELECT jsonb_build_object('id',id,'rate',50) FROM public.utility_services WHERE kind='meter')) $$,
  '23514', 'Сначала проверьте отправленный расчёт', 'tariffs cannot change while readings await review');
SELECT throws_ok($$ SELECT public.review_utility_bill((SELECT id FROM public.utility_bills WHERE status='pending'),false,'',CURRENT_DATE+7) $$,
  '23514', 'Укажите причину возврата, не более 1000 символов', 'rejection requires a reason');
SELECT is(public.review_utility_bill((SELECT id FROM public.utility_bills WHERE status='pending'),false,'Photo needs correction',CURRENT_DATE+7),'rejected','owner rejects with a reason');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE charge_type='utilities'),0::bigint,'rejected readings do not create debt');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', (date_trunc('month',CURRENT_DATE)-interval '1 month')::date,
  (SELECT jsonb_build_array(jsonb_build_object('service_id',id,'reading',103.2)) FROM public.utility_services WHERE kind='meter')) $$, 'tenant resubmits the rejected month');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.review_utility_bill((SELECT id FROM public.utility_bills WHERE status='pending'),true,NULL,CURRENT_DATE-1) $$,
  '23514','Укажите срок оплаты от сегодня до года вперёд','approval cannot create already overdue debt');
SELECT is(public.review_utility_bill((SELECT id FROM public.utility_bills WHERE status='pending'),true,NULL,CURRENT_DATE+7),'approved','owner approves bill');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE charge_type='utilities'),1::bigint,'approval creates one utility charge');
SELECT is((SELECT amount FROM public.rent_charges WHERE charge_type='utilities'),636.80::numeric,'utility charge matches approved amount');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE period_start=(date_trunc('month',CURRENT_DATE)-interval '1 month')::date),2::bigint,'rent and utilities coexist for the same month');
SELECT is(public.review_utility_bill((SELECT id FROM public.utility_bills WHERE status='approved'),true,NULL,CURRENT_DATE+7),'approved','retrying approval succeeds idempotently');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE charge_type='utilities'),1::bigint,'retrying approval never duplicates debt');
SELECT throws_ok($$ UPDATE public.rent_charges SET adjustment_amount=1,adjustment_reason='Tamper' WHERE charge_type='utilities' $$,
  '23514','Утверждённый коммунальный расчёт нельзя корректировать вручную','approved utility totals are immutable');
SELECT lives_ok($$ UPDATE public.lease_agreements SET monthly_payment=31000 WHERE id='94000000-0000-0000-0000-000000000001' $$,'rent terms can be updated');
SELECT is((SELECT amount FROM public.rent_charges WHERE charge_type='utilities'),636.80::numeric,'rebuilding rent schedule preserves utilities');
SELECT lives_ok($$ INSERT INTO public.rent_payments(charge_id,owner_id,tenant_id,amount,paid_at,payment_method) SELECT id,owner_id,tenant_id,100,now(),'cash' FROM public.rent_charges WHERE charge_type='utilities' $$,'utilities reuse the existing partial payment ledger');
SELECT is((SELECT paid_amount FROM public.rent_charges WHERE charge_type='utilities'),100::numeric,'utility payment updates outstanding balance');
SELECT lives_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', (SELECT jsonb_build_object('id',id,'rate',50) FROM public.utility_services WHERE kind='meter')) $$,'owner updates next-period tariff');
SELECT is((SELECT rate FROM public.utility_bill_items WHERE kind='meter' AND bill_id=(SELECT id FROM public.utility_bills WHERE status='approved')),42.75::numeric,'changing tariff preserves approved snapshot');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001', (date_trunc('month',CURRENT_DATE)-interval '1 month')::date, '[]') $$,
  '23514','Этот или более поздний месяц уже утверждён','approved periods cannot be billed again');
SELECT lives_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001',date_trunc('month',CURRENT_DATE)::date,
  (SELECT jsonb_build_array(jsonb_build_object('service_id',id,'reading',104.2)) FROM public.utility_services WHERE kind='meter')) $$,'tenant submits the next period');
SELECT is((SELECT amount FROM public.utility_bills WHERE status='pending'),550::numeric,'next month uses new tariff and approved baseline');
SELECT is((SELECT previous_reading FROM public.utility_bill_items WHERE bill_id=(SELECT id FROM public.utility_bills WHERE status='pending') AND kind='meter'),103.2::numeric,'rejected readings do not affect baseline');
INSERT INTO public.payment_reports(charge_id,owner_id,tenant_id,amount,paid_at,payment_method)
SELECT id,owner_id,tenant_id,536.80,now(),'cash' FROM public.rent_charges WHERE charge_type='utilities';

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.review_payment_report((SELECT id FROM public.payment_reports WHERE status='pending'),true,NULL) $$,'owner confirms a tenant payment report for utilities');
SELECT ok((SELECT paid_at IS NOT NULL AND paid_amount=636.80 FROM public.rent_charges WHERE charge_type='utilities'),'utility charge becomes fully paid');
SELECT is(public.review_utility_bill((SELECT id FROM public.utility_bills WHERE status='pending'),false,'Check again',CURRENT_DATE+7),'rejected','owner can return the next-period submission');
SELECT lives_ok($$ SELECT public.save_utility_service('94000000-0000-0000-0000-000000000001', (SELECT jsonb_build_object('id',id,'rate',500,'active',false) FROM public.utility_services WHERE kind='fixed')) $$,'owner disables a fixed service without deleting history');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001',date_trunc('month',CURRENT_DATE)::date,
  (SELECT jsonb_build_array(jsonb_build_object('service_id',id,'reading',103.2)) FROM public.utility_services WHERE kind='meter')) $$,'zero consumption creates a reviewable zero bill');

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(public.review_utility_bill((SELECT id FROM public.utility_bills WHERE status='pending'),true,NULL,CURRENT_DATE+7),'approved','owner approves zero consumption');
SELECT is((SELECT count(*) FROM public.rent_charges WHERE charge_type='utilities'),1::bigint,'zero bill creates no extra debt');
SELECT is((SELECT count(*) FROM public.utility_bill_items WHERE kind='fixed'),3::bigint,'disabled service remains in historical snapshots');

RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
SELECT throws_ok($$ SELECT * FROM public.utility_services $$,'42501','permission denied for table utility_services','anonymous users cannot read services');
SELECT throws_ok($$ SELECT * FROM public.utility_bills $$,'42501','permission denied for table utility_bills','anonymous users cannot read bills');
SELECT throws_ok($$ SELECT * FROM public.utility_bill_items $$,'42501','permission denied for table utility_bill_items','anonymous users cannot read readings');
SELECT throws_ok($$ SELECT public.submit_utility_readings('94000000-0000-0000-0000-000000000001',CURRENT_DATE,'[]') $$,'42501','permission denied for function submit_utility_readings','anonymous users cannot submit readings');

RESET ROLE;
-- Isolate the new utility FK cascade from the existing payment-report deletion trigger.
DELETE FROM public.payment_reports WHERE charge_id IN (
  SELECT id FROM public.rent_charges WHERE agreement_id='94000000-0000-0000-0000-000000000001'
);
SELECT lives_ok($$ DELETE FROM public.lease_agreements WHERE id='94000000-0000-0000-0000-000000000001' $$,'deleting a lease still cascades through utility history and payment rows');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT is((SELECT count(*) FROM public.utility_services WHERE agreement_id='94000000-0000-0000-0000-000000000001'),0::bigint,'lease deletion removes utility services');
SELECT * FROM finish();
ROLLBACK;
