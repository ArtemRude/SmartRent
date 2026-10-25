BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email,created_at,raw_user_meta_data) VALUES
('ba000000-0000-0000-0000-000000000001','billing-owner@example.invalid',now()-interval '1 year','{"role":"owner"}'),
('ba000000-0000-0000-0000-000000000002','billing-admin@example.invalid',now()-interval '1 year','{"role":"owner"}'),
('ba000000-0000-0000-0000-000000000003','billing-new@example.invalid',now()+interval '1 minute','{"role":"owner"}'),
('ba000000-0000-0000-0000-000000000004','billing-tenant@example.invalid',now()-interval '1 year','{"role":"tenant"}');
UPDATE public.user_roles SET role='admin' WHERE user_id='ba000000-0000-0000-0000-000000000002';
CREATE FUNCTION pg_temp.billing_expense() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('title','Maintenance','category','maintenance','planned_date',CURRENT_DATE,'planned_amount',1000,'status','planned','note','')$$;
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.billing_overview()->>'mode','prelaunch','billing starts dormant');
SELECT is(public.billing_overview()->>'trial_until',NULL::text,'no trial is consumed before launch');
SELECT ok(NOT has_table_privilege('authenticated','private.billing_subscriptions','UPDATE'),'client cannot mark itself paid');
SELECT ok(NOT has_table_privilege('authenticated','private.billing_settings','UPDATE'),'client cannot activate billing directly');
SELECT ok((SELECT NOT prosecdef FROM pg_proc WHERE oid='public.billing_overview()'::regprocedure),'public overview is invoker');
SELECT throws_ok($$SELECT public.billing_admin_launch(true)$$,'42501','Только администратор запускает тарифы','owner cannot launch');
SELECT throws_ok($$SELECT public.billing_admin_pause()$$,'42501','Только администратор управляет тарифами','owner cannot pause');
SELECT throws_ok($$SELECT public.billing_admin_set_subscription(auth.uid(),'team',now()+interval '1 month')$$,'42501','Только администратор назначает подписку','owner cannot self-upgrade');
SELECT lives_ok($$INSERT INTO public.properties(id,owner_id,name) VALUES('bb000000-0000-0000-0000-000000000001',auth.uid(),'One'),('bb000000-0000-0000-0000-000000000002',auth.uid(),'Two')$$,'prelaunch has no free-plan unit cap');
SELECT lives_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000001',pg_temp.billing_expense())$$,'paid modules are available free before launch');
SELECT set_config('test.billing_expense',(SELECT id::text FROM public.property_expenses WHERE property_id='bb000000-0000-0000-0000-000000000001'),true);
SELECT lives_ok($$SELECT public.invite_team_member('free-staff@example.invalid','viewer',ARRAY['bb000000-0000-0000-0000-000000000001']::uuid[])$$,'team has no plan gate before launch');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.billing_admin_launch(false)$$,'22023','Подтвердите запуск платных тарифов','admin must explicitly confirm');
SELECT is(public.billing_admin_launch(true)->>'mode','enforced','admin can explicitly launch');
SELECT set_config('test.billing_launch',public.billing_admin_launch(true)->>'launched_at',true);
SELECT is(public.billing_admin_launch(true)->>'launched_at',current_setting('test.billing_launch'),'repeated launch is idempotent');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000002',pg_temp.billing_expense())$$,'admin operation before owner notification stays unrestricted');
RESET ROLE;
SELECT is((SELECT notice_until FROM private.billing_subscriptions WHERE owner_id='ba000000-0000-0000-0000-000000000001'),NULL::timestamptz,'admin activity does not consume owner notification period');
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok((public.billing_overview()->>'notice_until')::timestamptz>=now()+interval '29 days','existing owner receives personal 30-day notice');
SELECT set_config('test.billing_notice',public.billing_overview()->>'notice_until',true);
SELECT is(public.billing_overview()->>'notice_until',current_setting('test.billing_notice'),'refresh does not restart notice');
SELECT lives_ok($$INSERT INTO public.properties(owner_id,name) VALUES(auth.uid(),'During notice')$$,'notice keeps the whole account unlocked');
RESET ROLE;
UPDATE private.billing_subscriptions SET notice_until=now()-interval '1 day' WHERE owner_id='ba000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO public.properties(owner_id,name) VALUES(auth.uid(),'Over cap')$$,'P0001',NULL,'new property blocked over free limit');
SELECT throws_ok($$INSERT INTO public.units(property_id,name) VALUES('bb000000-0000-0000-0000-000000000001','New unit')$$,'P0001',NULL,'new unit blocked for an over-limit account');
SELECT throws_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000001',pg_temp.billing_expense())$$,'P0001',NULL,'new expense needs Owner');
SELECT lives_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000001',pg_temp.billing_expense()||'{"note":"Continue existing"}',current_setting('test.billing_expense')::uuid,1)$$,'existing expense can still be completed');
SELECT lives_ok($$UPDATE public.properties SET description='History stays editable' WHERE id='bb000000-0000-0000-0000-000000000001'$$,'existing property remains editable');
SELECT lives_ok($$INSERT INTO public.tenants(id,owner_id,name) VALUES('bc000000-0000-0000-0000-000000000001',auth.uid(),'Tenant')$$,'tenant records remain available');
SELECT throws_ok($$INSERT INTO public.lease_agreements(owner_id,property_id,tenant_id,start_date,end_date,status) VALUES(auth.uid(),'bb000000-0000-0000-0000-000000000001','bc000000-0000-0000-0000-000000000001',CURRENT_DATE,CURRENT_DATE+30,'draft')$$,'P0001',NULL,'over-limit account cannot create new agreements');
SELECT throws_ok($$SELECT public.invite_team_member('blocked-staff@example.invalid','viewer',ARRAY['bb000000-0000-0000-0000-000000000001']::uuid[])$$,'P0001',NULL,'new invitation needs Team');
RESET ROLE;
-- Administrators acting for another account cannot bypass its paid feature gates.
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000001',pg_temp.billing_expense())$$,'P0001',NULL,'admin RPC bills the property owner, not the acting admin');
SELECT lives_ok($$SELECT public.billing_admin_set_subscription('ba000000-0000-0000-0000-000000000001','owner',now()+interval '1 month')$$,'admin records confirmed manual pilot subscription');
SELECT throws_ok($$SELECT public.billing_admin_set_subscription('ba000000-0000-0000-0000-000000000001','team',NULL)$$,'22023',NULL,'paid plans require a finite future period');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000001',pg_temp.billing_expense())$$,'active Owner allows new expense');
RESET ROLE;
UPDATE private.billing_subscriptions SET paid_until=now()-interval '6 days' WHERE owner_id='ba000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000001',pg_temp.billing_expense())$$,'7-day payment grace retains the paid plan');
RESET ROLE;
UPDATE private.billing_subscriptions SET paid_until=now()-interval '8 days' WHERE owner_id='ba000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000001',pg_temp.billing_expense())$$,'P0001',NULL,'expired grace falls back to free plan');
RESET ROLE;
-- A postlaunch account gets Portfolio trial, with a genuine 20-unit limit and no seats.
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok((public.billing_overview()->>'trial_until')::timestamptz>now()+interval '29 days','new owner receives 30-day Portfolio trial');
SELECT is(public.billing_overview()->>'notice_until',NULL::text,'new account does not receive an extra unlimited notice');
SELECT lives_ok($$INSERT INTO public.properties(id,owner_id,name) VALUES('bb000000-0000-0000-0000-000000000003',auth.uid(),'Trial')$$,'trial enables property');
SELECT lives_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000003',pg_temp.billing_expense())$$,'trial enables expense');
SELECT throws_ok($$SELECT public.invite_team_member('trial-staff@example.invalid','viewer',ARRAY['bb000000-0000-0000-0000-000000000003']::uuid[])$$,'P0001',NULL,'Portfolio trial does not include Team seats');
RESET ROLE;
UPDATE private.billing_subscriptions SET trial_until=now()-interval '1 second' WHERE owner_id='ba000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_property_expense('bb000000-0000-0000-0000-000000000003',pg_temp.billing_expense())$$,'P0001',NULL,'trial ends without payment grace');
SELECT lives_ok($$INSERT INTO public.units(property_id,name) VALUES('bb000000-0000-0000-0000-000000000003','Implicit to explicit')$$,'first unit replaces the whole-property unit');
SELECT throws_ok($$INSERT INTO public.units(property_id,name) VALUES('bb000000-0000-0000-0000-000000000003','Second unit')$$,'P0001',NULL,'second unit exceeds Start limit');
RESET ROLE;
-- Multi-row writes must see their own earlier rows; archived drafts must not hide capacity.
INSERT INTO public.tenants(id,owner_id,name) VALUES('bc000000-0000-0000-0000-000000000003','ba000000-0000-0000-0000-000000000003','New owner tenant');
INSERT INTO public.lease_agreements(id,owner_id,property_id,tenant_id,start_date,end_date,status)
VALUES('be000000-0000-0000-0000-000000000003','ba000000-0000-0000-0000-000000000003','bb000000-0000-0000-0000-000000000003','bc000000-0000-0000-0000-000000000003',CURRENT_DATE,CURRENT_DATE+30,'draft');
SET LOCAL ROLE authenticated;
UPDATE public.properties SET status='archived' WHERE id='bb000000-0000-0000-0000-000000000003';
SELECT is((public.billing_overview()->>'units_used')::integer,0,'archived draft does not occupy an active rental unit');
SELECT throws_ok($$INSERT INTO public.properties(owner_id,name) VALUES(auth.uid(),'Batch one'),(auth.uid(),'Batch two')$$,'P0001',NULL,'multi-row insert cannot exceed Start cap');
SELECT is((public.billing_overview()->>'units_used')::integer,0,'failed multi-row insert is atomic');
SELECT throws_ok($$INSERT INTO public.lease_agreements(owner_id,property_id,tenant_id,start_date,end_date,status)
VALUES(auth.uid(),'bb000000-0000-0000-0000-000000000003','bc000000-0000-0000-0000-000000000003',CURRENT_DATE,CURRENT_DATE+30,'draft')$$,'23514','Восстановите объект из архива перед новым договором','new archived-property agreements require restoration');
SELECT throws_ok($$UPDATE public.lease_agreements SET status='pending_signature' WHERE id='be000000-0000-0000-0000-000000000003'$$,'23514','Восстановите объект из архива перед новым договором','archived draft cannot activate past billing capacity checks');
SELECT lives_ok($$UPDATE public.properties SET status='active' WHERE id='bb000000-0000-0000-0000-000000000003'$$,'restore can use a genuinely free rental slot');
RESET ROLE;
INSERT INTO public.lease_agreements(owner_id,property_id,tenant_id,start_date,end_date,status,signed_document_file)
VALUES('ba000000-0000-0000-0000-000000000003','bb000000-0000-0000-0000-000000000003','bc000000-0000-0000-0000-000000000003',CURRENT_DATE,CURRENT_DATE+30,'active','signed.pdf');
SELECT throws_ok($$INSERT INTO public.lease_agreements(owner_id,property_id,unit_id,tenant_id,start_date,end_date,status,signed_document_file)
SELECT 'ba000000-0000-0000-0000-000000000003','bb000000-0000-0000-0000-000000000003',u.id,'bc000000-0000-0000-0000-000000000003',CURRENT_DATE,CURRENT_DATE+30,'active','signed.pdf'
FROM public.units u WHERE property_id='bb000000-0000-0000-0000-000000000003'$$,'P0001',NULL,'new counted contract cannot add a second billable space on Start');

SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT public.billing_admin_set_subscription('ba000000-0000-0000-0000-000000000001','team',now()+interval '1 month');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.invite_team_member('staff-'||n||'@example.invalid','viewer',ARRAY['bb000000-0000-0000-0000-000000000001']::uuid[]) FROM generate_series(1,4)n$$,'Team reserves five seats including prelaunch pending invitation');
SELECT is((public.billing_overview()->>'seats_used')::integer,5,'pending invitations reserve seats');
SELECT throws_ok($$SELECT public.invite_team_member('sixth@example.invalid','viewer',ARRAY['bb000000-0000-0000-0000-000000000001']::uuid[])$$,'P0001',NULL,'sixth invite is blocked');
RESET ROLE;
-- Expired invitations can be reissued only if the plan still includes a free seat.
UPDATE public.team_memberships SET expires_at=now()-interval '1 day' WHERE owner_id='ba000000-0000-0000-0000-000000000001' AND email='staff-1@example.invalid';
SET LOCAL ROLE authenticated;
SELECT is((public.billing_overview()->>'seats_used')::integer,4,'expired invite frees a seat');
SELECT lives_ok($$SELECT public.invite_team_member('staff-1@example.invalid','viewer',ARRAY['bb000000-0000-0000-0000-000000000001']::uuid[])$$,'expired invitation can reserve the freed seat again');
RESET ROLE;
-- Legacy prelaunch invitations can exceed five; acceptance cannot silently add a sixth seat.
UPDATE private.billing_settings SET mode='prelaunch' WHERE singleton;
INSERT INTO public.team_memberships(id,owner_id,email,role,status) VALUES('b3000000-0000-0000-0000-000000000006','ba000000-0000-0000-0000-000000000001','legacy-sixth@example.invalid','viewer','invited');
UPDATE private.billing_settings SET mode='enforced' WHERE singleton;
SELECT throws_ok($$UPDATE public.team_memberships SET status='active',token_hash=NULL WHERE id='b3000000-0000-0000-0000-000000000006'$$,'P0001',NULL,'legacy sixth pending seat cannot be accepted');
UPDATE public.team_memberships SET status='revoked',token_hash=NULL WHERE id='b3000000-0000-0000-0000-000000000006';
SELECT lives_ok($$UPDATE public.team_memberships SET status='active',token_hash=NULL WHERE owner_id='ba000000-0000-0000-0000-000000000001' AND email='staff-1@example.invalid'$$,'reserved valid invitation can be accepted within five seats');
-- Operational modules: new work is gated, history and previously started work continue.
INSERT INTO public.units(id,property_id,name) VALUES('bd000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001','Occupied');
INSERT INTO public.lease_agreements(id,owner_id,property_id,unit_id,tenant_id,start_date,end_date,status,signed_document_file)
VALUES('be000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001','bd000000-0000-0000-0000-000000000001','bc000000-0000-0000-0000-000000000001',CURRENT_DATE,CURRENT_DATE+30,'active','signed.pdf');
INSERT INTO public.repair_jobs(id,property_id,owner_id,title,scheduled_date,due_date,estimate_items,estimated_total)
VALUES('bf000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001','Existing repair',CURRENT_DATE,CURRENT_DATE+1,'[]',100);
INSERT INTO public.property_listings(id,property_id,status) VALUES('b1000000-0000-0000-0000-000000000001','bb000000-0000-0000-0000-000000000001','paused');
INSERT INTO public.lease_amendments(id,agreement_id,status,effective_from,monthly_payment,end_date,previous_monthly_payment,previous_end_date,agreement_snapshot,submitted_at)
VALUES('b2000000-0000-0000-0000-000000000001','be000000-0000-0000-0000-000000000001','pending',(date_trunc('month',CURRENT_DATE)+interval '1 month')::date,200,CURRENT_DATE+90,100,CURRENT_DATE+30,'{}',now());
UPDATE private.billing_subscriptions SET paid_until=now()-interval '8 days' WHERE owner_id='ba000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
-- The module RPCs run privileged table writes; executing under postgres here exercises
-- the exact same row guards without weakening the real table grants.
SELECT throws_ok($$INSERT INTO public.repair_jobs(property_id,owner_id,title,scheduled_date,due_date,estimate_items,estimated_total)
VALUES('bb000000-0000-0000-0000-000000000001','ba000000-0000-0000-0000-000000000001','New repair',CURRENT_DATE,CURRENT_DATE+1,'[]',100)$$,'P0001',NULL,'new repair requires Portfolio');
SELECT lives_ok($$UPDATE public.repair_jobs SET title='Continued repair' WHERE id='bf000000-0000-0000-0000-000000000001'$$,'existing repair can continue after expiry');
SELECT throws_ok($$INSERT INTO public.property_listings(property_id) VALUES('bb000000-0000-0000-0000-000000000002')$$,'P0001',NULL,'new listing requires Portfolio');
SELECT throws_ok($$UPDATE public.property_listings SET status='published' WHERE id='b1000000-0000-0000-0000-000000000001'$$,'P0001',NULL,'republication requires Portfolio');
SELECT lives_ok($$UPDATE public.property_listings SET draft='{"note":"history available"}' WHERE id='b1000000-0000-0000-0000-000000000001'$$,'existing listing draft stays editable');
SELECT throws_ok($$UPDATE public.lease_agreements SET end_date=end_date+30 WHERE id='be000000-0000-0000-0000-000000000001'$$,'P0001',NULL,'direct renewal over unit cap is blocked');
SELECT throws_ok($$INSERT INTO public.lease_amendments(agreement_id,effective_from,monthly_payment,end_date,previous_monthly_payment,previous_end_date,agreement_snapshot)
VALUES('be000000-0000-0000-0000-000000000001',(date_trunc('month',CURRENT_DATE)+interval '1 month')::date,200,CURRENT_DATE+90,100,CURRENT_DATE+30,'{}')$$,'P0001',NULL,'new renewal addendum over unit cap is blocked');
UPDATE public.lease_amendments SET status='accepted' WHERE id='b2000000-0000-0000-0000-000000000001';
SELECT lives_ok($$UPDATE public.lease_agreements SET end_date=CURRENT_DATE+90 WHERE id='be000000-0000-0000-0000-000000000001'$$,'already submitted renewal may finish after expiry');
SELECT lives_ok($$UPDATE public.properties SET status='archived' WHERE id='bb000000-0000-0000-0000-000000000001'$$,'occupied property may archive without erasing billing usage');
SELECT is(private.billing_units_used('ba000000-0000-0000-0000-000000000001'),3,'occupied archived property still counts');
SELECT throws_ok($$DELETE FROM public.units WHERE id='bd000000-0000-0000-0000-000000000001'$$,'23514','Завершите договор перед удалением занятого помещения','occupied unit cannot be removed to bypass its limit');
SELECT lives_ok($$UPDATE public.lease_agreements SET status='completed' WHERE id='be000000-0000-0000-0000-000000000001'$$,'contract completion remains available');
SELECT is(private.billing_units_used('ba000000-0000-0000-0000-000000000001'),2,'completed archived property stops counting');
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000004","role":"authenticated","user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.billing_overview()$$,'42501','Тариф доступен собственнику','tenant cannot read an owner billing account');
SELECT throws_ok($$SELECT public.billing_admin_launch(true)$$,'42501','Только администратор запускает тарифы','forged user metadata cannot launch billing');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.billing_admin_pause()->>'mode','prelaunch','admin can roll back immediately');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"ba000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO public.properties(owner_id,name) VALUES(auth.uid(),'Rollback unlocked')$$,'rollback removes unit cap again');
SELECT lives_ok($$SELECT public.invite_team_member('rollback-staff@example.invalid','viewer',ARRAY['bb000000-0000-0000-0000-000000000003']::uuid[])$$,'rollback removes feature gate again');
RESET ROLE;
SELECT is((SELECT count(*) FROM private.billing_events WHERE action='launch'),1::bigint,'launch is audited once');
SELECT is((SELECT count(*) FROM private.billing_events WHERE action='pause'),1::bigint,'pause is audited');
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.billing_overview()$$,'42501','permission denied for function billing_overview','anonymous billing access is denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
