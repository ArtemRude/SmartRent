BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('91000000-0000-0000-0000-000000000001','expense-owner@example.invalid','{"role":"owner"}'),
('91000000-0000-0000-0000-000000000002','expense-tenant@example.invalid','{"role":"tenant"}'),
('91000000-0000-0000-0000-000000000003','expense-stranger@example.invalid','{"role":"owner"}'),
('91000000-0000-0000-0000-000000000004','expense-admin@example.invalid','{"role":"owner"}');
UPDATE public.user_roles SET role='admin' WHERE user_id='91000000-0000-0000-0000-000000000004';
INSERT INTO public.properties(id,owner_id,name,address) VALUES
('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','Owner apartment','Address'),
('92000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000003','Other apartment','Address');
INSERT INTO public.tenants(id,owner_id,user_id,name,email) VALUES('93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','Expense Tenant','expense-tenant@example.invalid');
INSERT INTO public.lease_agreements(id,owner_id,property_id,tenant_id,start_date,end_date,monthly_payment,status,signed_document_file)
VALUES('94000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001',CURRENT_DATE-30,CURRENT_DATE+60,30000,'active','test/signed.pdf');
CREATE FUNCTION pg_temp.expense_payload() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
 'title','Repair','category','repair','planned_date',CURRENT_DATE,'planned_amount',2500,'status','planned','paid_date',NULL,'paid_amount',NULL,'receipt_file',NULL,'note','Small repair') $$;
SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT has_table_privilege('authenticated','public.property_expenses','INSERT,UPDATE,DELETE'),'all mutations require validated RPC');
SELECT ok(NOT has_table_privilege('authenticated','public.property_expense_events','INSERT,UPDATE,DELETE'),'clients cannot rewrite history');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.property_expenses'::regclass,'public.property_expense_events'::regclass)),'expense tables enable RLS');
SELECT ok((SELECT NOT prosecdef FROM pg_proc WHERE oid='public.save_property_expense(uuid,jsonb,uuid,integer,text)'::regprocedure),'public API is invoker; privileged code is private');
SELECT lives_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload())$$,'owner plans expense');
SELECT set_config('test.expense_id',(SELECT id::text FROM public.property_expenses),true);
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000002',pg_temp.expense_payload())$$,'42501','Нет доступа к расходам объекта','owner cannot assign expenses to foreign property');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload(),current_setting('test.expense_id')::uuid,0)$$,'40001','Расход изменился. Обновите данные и повторите действие','stale updates fail');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||'{"planned_amount":"NaN"}')$$,'23514','Укажите плановую сумму с точностью до копеек','NaN rejected');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||'{"planned_amount":0.001}')$$,'23514','Укажите плановую сумму с точностью до копеек','fractional kopecks rejected');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||'{"planned_amount":0}')$$,'23514','Проверьте плановую сумму и дату','zero rejected');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||'{"status":"paid","paid_amount":3000,"paid_date":"2999-01-01"}')$$,'23514','Проверьте сумму и дату оплаты: будущая оплата недопустима','future payments rejected');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('expense-receipts','91000000-0000-0000-0000-000000000001/92000000-0000-0000-0000-000000000001/owner.pdf','91000000-0000-0000-0000-000000000001');
SELECT lives_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||jsonb_build_object('status','paid','paid_amount',3000.25,'paid_date',CURRENT_DATE,'receipt_file','91000000-0000-0000-0000-000000000001/92000000-0000-0000-0000-000000000001/owner.pdf'),current_setting('test.expense_id')::uuid,1)$$,'owner records actual expense with uploaded document');
SELECT is((SELECT planned_amount FROM public.property_expenses),2500::numeric,'original plan retained');
SELECT is((SELECT paid_amount FROM public.property_expenses),3000.25::numeric,'actual cost keeps kopecks');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload(),current_setting('test.expense_id')::uuid,2,'undo')$$,'23514','Для исправления оплаченного расхода укажите причину; отмена оплаты недоступна','paid expense cannot be silently erased');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||jsonb_build_object('status','paid','paid_amount',4000,'paid_date',CURRENT_DATE),current_setting('test.expense_id')::uuid,2)$$,'23514','Для исправления оплаченного расхода укажите причину; отмена оплаты недоступна','paid correction requires reason');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.property_expenses),0::bigint,'linked tenant cannot see internal expenses');
SELECT is((SELECT count(*) FROM public.property_expense_events),0::bigint,'linked tenant cannot see history');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='expense-receipts'),0::bigint,'linked tenant cannot see documents');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload())$$,'42501','Нет доступа к расходам объекта','tenant cannot create expenses');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('expense-receipts','91000000-0000-0000-0000-000000000002/92000000-0000-0000-0000-000000000001/tenant.pdf','91000000-0000-0000-0000-000000000002')$$,'42501',NULL,'tenant cannot upload internal document');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000003","role":"authenticated","user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.property_expenses),0::bigint,'unrelated owner and forged metadata grant no access');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload(),current_setting('test.expense_id')::uuid,2)$$,'42501','Нет доступа к расходам объекта','unrelated owner cannot edit guessed expense id');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000002',pg_temp.expense_payload(),current_setting('test.expense_id')::uuid,2)$$,'42501','Расход не найден в этом объекте','expense cannot be moved to another property');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.property_expenses),1::bigint,'DB admin sees another owner expense');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='expense-receipts'),1::bigint,'admin reads attached owner document');
SELECT lives_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||jsonb_build_object('status','paid','paid_amount',2750.10,'paid_date',CURRENT_DATE,'receipt_file','91000000-0000-0000-0000-000000000001/92000000-0000-0000-0000-000000000001/owner.pdf'),current_setting('test.expense_id')::uuid,2,'Supplier corrected receipt')$$,'admin corrects actual cost and preserves owner document');
SELECT is((SELECT count(*) FROM public.property_expense_events WHERE actor_id=auth.uid() AND reason='Supplier corrected receipt'),1::bigint,'audit stores actual administrator and reason');
SELECT is((SELECT (snapshot->>'paid_amount')::numeric FROM public.property_expense_events WHERE (snapshot->>'revision')::integer=2),3000.25::numeric,'previous actual cost remains in history');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||jsonb_build_object('status','paid','paid_amount',2750.10,'paid_date',CURRENT_DATE,'planned_amount',5000),current_setting('test.expense_id')::uuid,3,'Change plan')$$,'23514','При оплате исходный план сохраняется. Укажите фактические сумму и дату отдельно','original budget cannot be overwritten on a paid expense');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||jsonb_build_object('status','paid','paid_amount',10,'paid_date',CURRENT_DATE,'receipt_file','fake.pdf'))$$,'42501','Приложите чек, загруженный для этого объекта','forged attachment rejected');
SELECT lives_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000002',pg_temp.expense_payload())$$,'admin plans expense for another property');
SELECT set_config('test.cancel_id',(SELECT id::text FROM public.property_expenses WHERE property_id='92000000-0000-0000-0000-000000000002'),true);
SELECT lives_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000002',pg_temp.expense_payload()||'{"status":"cancelled"}',current_setting('test.cancel_id')::uuid,1,'Not required')$$,'planned expense can be cancelled without deleting history');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000002',pg_temp.expense_payload(),current_setting('test.cancel_id')::uuid,2)$$,'23514','Отменённый расход нельзя изменить','cancelled records immutable');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload()||jsonb_build_object('status','paid','paid_amount',2750.10,'paid_date',CURRENT_DATE),current_setting('test.expense_id')::uuid,3,'Receipt replaced by historical reference')$$,'owner may remove current attachment while retaining historical document');
DELETE FROM storage.objects WHERE bucket_id='expense-receipts';
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='expense-receipts'),1::bigint,'historical document cannot be deleted');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.property_expenses$$,'42501','permission denied for table property_expenses','anonymous cannot read');
SELECT throws_ok($$SELECT public.save_property_expense('92000000-0000-0000-0000-000000000001',pg_temp.expense_payload())$$,'42501','permission denied for function save_property_expense','anonymous cannot invoke writes');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
