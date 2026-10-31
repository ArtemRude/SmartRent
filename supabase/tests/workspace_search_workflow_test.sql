BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('5e100000-0000-4000-8000-000000000001','search-owner@example.invalid',now(),'{"name":"Поиск Владелец","role":"owner"}'),
 ('5e100000-0000-4000-8000-000000000002','search-other@example.invalid',now(),'{"name":"Поиск Другой","role":"owner"}'),
 ('5e100000-0000-4000-8000-000000000003','search-manager@example.invalid',now(),'{"name":"Поиск Управляющий","role":"owner"}'),
 ('5e100000-0000-4000-8000-000000000004','search-viewer@example.invalid',now(),'{"name":"Поиск Наблюдатель","role":"tenant"}'),
 ('5e100000-0000-4000-8000-000000000005','search-tenant@example.invalid',now(),'{"name":"Поиск Жилец","role":"tenant"}'),
 ('5e100000-0000-4000-8000-000000000006','search-admin@example.invalid',now(),'{"name":"Поиск Админ","role":"owner"}'),
 ('5e100000-0000-4000-8000-000000000007','search-outsider@example.invalid',now(),'{"name":"Поиск Посторонний","role":"admin"}'),
 ('5e100000-0000-4000-8000-000000000008','search-other-tenant@example.invalid',now(),'{"name":"Поиск Второй","role":"tenant"}');
-- Metadata never grants admin: only the canonical role row does.
UPDATE public.user_roles SET role='admin' WHERE user_id='5e100000-0000-4000-8000-000000000006';
UPDATE public.user_roles SET role='tenant' WHERE user_id='5e100000-0000-4000-8000-000000000007';
INSERT INTO public.properties(id,owner_id,name,address,description) VALUES
 ('5e200000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000001','Поиск Берёза','Садовая, 12','PROPERTY_DESCRIPTION_SECRET'),
 ('5e200000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000001','Поиск %% квартира','Другая, 10','UNASSIGNED_DESCRIPTION_SECRET'),
 ('5e200000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000002','Поиск Чужой','OTHER_ADDRESS_SECRET','OTHER_PROPERTY_SECRET'),
 ('5e200000-0000-4000-8000-000000000004','5e100000-0000-4000-8000-000000000003','Поиск Свой объект управляющего','Своя, 4',''),
 ('5e200000-0000-4000-8000-000000000005','5e100000-0000-4000-8000-000000000002','Поиск Личная аренда управляющего','Личная, 5','');
INSERT INTO public.tenants(id,owner_id,user_id,name,email,phone) VALUES
 ('5e300000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000005','Поиск Анна','anna-search@example.invalid','PHONE_SECRET_A'),
 ('5e300000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000008','Поиск Борис','OTHER_TENANT_CONTACT_SECRET@example.invalid','PHONE_SECRET_B'),
 ('5e300000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000003','Поиск Личный','personal-search@example.invalid','');
INSERT INTO public.lease_agreements(id,owner_id,property_id,tenant_id,start_date,end_date,monthly_payment,status,signed_document_file,contract_details) VALUES
 ('5e400000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000001','5e300000-0000-4000-8000-000000000001',CURRENT_DATE-10,CURRENT_DATE+20,60000,'active','DOCUMENT_SECRET.pdf','{"passport":"PASSPORT_SECRET","agreementNumber":"Д-2026/01"}'),
 ('5e400000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000001','5e300000-0000-4000-8000-000000000002',CURRENT_DATE-10,CURRENT_DATE+20,70000,'active','OTHER_DOCUMENT_SECRET.pdf','{}'),
 ('5e400000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000002','5e300000-0000-4000-8000-000000000002',CURRENT_DATE-10,CURRENT_DATE+20,80000,'active','UNASSIGNED_DOCUMENT_SECRET.pdf','{}'),
 ('5e400000-0000-4000-8000-000000000004','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000002','5e300000-0000-4000-8000-000000000001',CURRENT_DATE+30,CURRENT_DATE+40,90000,'draft',NULL,'{"secret":"DRAFT_SECRET"}'),
 ('5e400000-0000-4000-8000-000000000005','5e100000-0000-4000-8000-000000000002','5e200000-0000-4000-8000-000000000005','5e300000-0000-4000-8000-000000000003',CURRENT_DATE-10,CURRENT_DATE+20,40000,'active','PERSONAL_DOCUMENT_SECRET.pdf','{}');
INSERT INTO public.requests(id,owner_id,property_id,tenant_id,title,description,category) VALUES
 ('5e500000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000001','5e300000-0000-4000-8000-000000000001','Поиск Смеситель','REQUEST_DESCRIPTION_SECRET','repair'),
 ('5e500000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000001','5e300000-0000-4000-8000-000000000002','Поиск Окно','OTHER_REQUEST_DESCRIPTION_SECRET','repair'),
 ('5e500000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000002','5e300000-0000-4000-8000-000000000002','Поиск Не назначен','','repair'),
 ('5e500000-0000-4000-8000-000000000004','5e100000-0000-4000-8000-000000000002','5e200000-0000-4000-8000-000000000005','5e300000-0000-4000-8000-000000000003','Поиск Личная заявка','','repair');
INSERT INTO public.team_memberships(id,owner_id,user_id,email,role,status) VALUES
 ('5e600000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000003','search-manager@example.invalid','manager','active'),
 ('5e600000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000004','search-viewer@example.invalid','viewer','active');
INSERT INTO public.team_property_access VALUES
 ('5e600000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000001'),
 ('5e600000-0000-4000-8000-000000000002','5e200000-0000-4000-8000-000000000001');
CREATE FUNCTION pg_temp.search_item(p_kind text,p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT value FROM jsonb_array_elements(current_setting('test.search')::jsonb->'items') WHERE value->>'kind'=p_kind AND value->>'id'=p_id::text;
$$;
SELECT ok(NOT has_function_privilege('anon','public.workspace_search(text)','EXECUTE'),'anonymous search execution revoked');
SELECT ok(NOT has_function_privilege('anon','private.workspace_search(text)','EXECUTE'),'anonymous private search execution revoked');
SELECT ok(NOT has_function_privilege('anon','public.workspace_search_team_request(uuid)','EXECUTE'),'anonymous exact team request execution revoked');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.workspace_search(text)'::regprocedure),'public search wrapper is invoker');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.workspace_search_team_request(uuid)'::regprocedure),'public request wrapper is invoker');
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.workspace_search('поиск')$$,'42501',NULL,'authenticated DB role without uid cannot search');
SELECT throws_ok($$SELECT public.workspace_search_team_request('5e500000-0000-4000-8000-000000000001')$$,'42501',NULL,'exact team read requires uid');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.workspace_search('поиск')$$,'42501',NULL,'anonymous execution actually denied');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.search',public.workspace_search('  ПОИСК  ')::text,true);
SELECT is((SELECT count(DISTINCT value->>'kind')::int FROM jsonb_array_elements(current_setting('test.search')::jsonb->'items')),4,'owner sees all four categories');
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000001') IS NOT NULL,'owner sees own property');
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000003') IS NULL,'owner cannot search another owner property');
SELECT is(pg_temp.search_item('tenant','5e300000-0000-4000-8000-000000000001')->>'subtitle','anna-search@example.invalid','owner can identify own tenant by email');
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000004') IS NOT NULL,'owner sees own draft contract');
SELECT ok(current_setting('test.search') NOT LIKE '%PASSPORT_SECRET%' AND current_setting('test.search') NOT LIKE '%DOCUMENT_SECRET%' AND current_setting('test.search') NOT LIKE '%DESCRIPTION_SECRET%' AND current_setting('test.search') NOT LIKE '%PHONE_SECRET%','response excludes documents, descriptions and phone values');
SELECT is(jsonb_array_length(public.workspace_search('') -> 'items'),0,'empty query returns no records');
SELECT is(jsonb_array_length(public.workspace_search('п') -> 'items'),0,'one character query returns no records');
SELECT throws_ok($$SELECT public.workspace_search(repeat('я',101))$$,'22023',NULL,'overlong query rejected');
SELECT is(jsonb_array_length(public.workspace_search('несуществующий-поиск') -> 'items'),0,'no matches is an explicit empty result');
-- The matching property also identifies two of its contracts and its request.
SELECT is(jsonb_array_length(public.workspace_search('%%') -> 'items'),4,'literal percent signs match only the named property and its related records');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.workspace_search('%%')->'items') i
 WHERE i->>'property_id' IS DISTINCT FROM '5e200000-0000-4000-8000-000000000002'),
 'literal percent query never expands to unrelated records');
SELECT is(jsonb_array_length(public.workspace_search('__') -> 'items'),0,'underscores are literal not wildcards');
SELECT is(jsonb_array_length(public.workspace_search($q$' OR 1=1 --$q$) -> 'items'),0,'query text is never interpreted as SQL');
SELECT ok(jsonb_array_length(public.workspace_search('береза') -> 'items')>0,'Cyrillic case and ё normalize');
SELECT ok(jsonb_array_length(public.workspace_search('  Поиск   Берёза  ') -> 'items')>0,'query whitespace normalizes');
SELECT is((public.workspace_search('поиск')->>'has_more')::boolean,false,'small result does not claim truncation');
SELECT ok(jsonb_array_length(public.workspace_search('5e500000-0000-4000-8000-000000000001')->'items')=1,'exact request UUID searchable');
SELECT is(jsonb_array_length(public.workspace_search('д-2026/01')->'items'),1,'human-readable contract number searchable');
SELECT is(public.workspace_search('д-2026/01')->'items'->0->>'id','5e400000-0000-4000-8000-000000000001','contract number resolves its exact agreement');
SELECT is(jsonb_array_length(public.workspace_search('PASSPORT_SECRET')->'items'),0,'private contract fields are not searchable');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.search',public.workspace_search('поиск')::text,true);
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000001') IS NOT NULL,'tenant sees currently visible own property');
SELECT is(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000001')->>'access','tenant','tenant property has tenant-safe destination capability');
SELECT is(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000001')->>'agreement_id','5e400000-0000-4000-8000-000000000001','tenant property identifies own exact lease');
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000002') IS NULL,'draft tenancy does not expose property');
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000001') IS NOT NULL,'tenant sees own visible contract');
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000004') IS NULL,'tenant cannot search own draft contract');
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000002') IS NULL,'tenant cannot search cotenant contract');
SELECT ok(pg_temp.search_item('request','5e500000-0000-4000-8000-000000000001') IS NOT NULL,'tenant sees own request');
SELECT ok(pg_temp.search_item('request','5e500000-0000-4000-8000-000000000002') IS NULL,'tenant cannot search cotenant request');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_setting('test.search')::jsonb->'items') i WHERE i->>'kind'='tenant'),'tenant gets no owner-only tenant directory');
SELECT ok(public.workspace_search_team_request('5e500000-0000-4000-8000-000000000001') IS NULL,'tenant cannot use team reader on own request');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.search',public.workspace_search('поиск')::text,true);
SELECT is(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000001')->>'access','team','manager sees only assigned operational property');
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000002') IS NULL,'manager cannot search unassigned same-owner property');
SELECT is(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000004')->>'access','owner','mixed manager retains own property rights');
SELECT is(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000005')->>'access','tenant','mixed manager retains personal tenancy');
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000005') IS NOT NULL,'mixed manager sees own personal contract');
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000001') IS NULL,'manager gets no team private contract');
SELECT ok(pg_temp.search_item('tenant','5e300000-0000-4000-8000-000000000001') IS NULL,'manager gets no team tenant directory');
SELECT ok(current_setting('test.search') NOT LIKE '%OTHER_TENANT_CONTACT_SECRET%' AND current_setting('test.search') NOT LIKE '%PHONE_SECRET%','manager search response excludes tenant contacts');
SELECT is(pg_temp.search_item('request','5e500000-0000-4000-8000-000000000001')->>'access','team','manager can search scoped request');
SELECT ok(pg_temp.search_item('request','5e500000-0000-4000-8000-000000000003') IS NULL,'manager cannot search unassigned requests');
SELECT is(public.workspace_search_team_request('5e500000-0000-4000-8000-000000000001')->'request'->>'description','REQUEST_DESCRIPTION_SECRET','team exact reader exposes authorized existing workspace content');
SELECT ok(public.workspace_search_team_request('5e500000-0000-4000-8000-000000000003') IS NULL,'team exact reader rejects guessed unassigned request');
SELECT ok(public.workspace_search_team_request(NULL) IS NULL,'null exact request unavailable');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.search',public.workspace_search('поиск')::text,true);
SELECT ok(pg_temp.search_item('request','5e500000-0000-4000-8000-000000000002') IS NOT NULL,'viewer can search assigned workspace requests');
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000001') IS NULL,'viewer cannot search team private contracts');
SELECT ok(public.workspace_search_team_request('5e500000-0000-4000-8000-000000000001') IS NOT NULL,'viewer exact request read retains existing read-only scope');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000007","role":"authenticated","user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.workspace_search('поиск')->'items'),0,'metadata admin claim cannot grant search access');
SELECT ok(public.workspace_search_team_request('5e500000-0000-4000-8000-000000000001') IS NULL,'outsider cannot read exact team request');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000006","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.search',public.workspace_search('поиск')::text,true);
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000003') IS NOT NULL,'canonical admin sees different owner property');
SELECT ok(pg_temp.search_item('tenant','5e300000-0000-4000-8000-000000000001') IS NOT NULL,'canonical admin sees tenant directory');
SELECT is(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000004')->>'access','owner','admin contract destination is authorized management context');
RESET ROLE;

-- Many newer records must not hide an exact older match or exact team selection.
INSERT INTO public.properties(owner_id,name,address)
 SELECT '5e100000-0000-4000-8000-000000000002','Предел чужой '||i,'' FROM generate_series(1,25) i;
INSERT INTO public.properties(owner_id,name,address)
 SELECT '5e100000-0000-4000-8000-000000000001','Предел свой '||i,'' FROM generate_series(1,12) i;
INSERT INTO public.requests(owner_id,property_id,tenant_id,title,category)
 SELECT '5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000001','5e300000-0000-4000-8000-000000000001','Новая заявка '||i,'repair' FROM generate_series(1,210) i;
SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.workspace_search('предел')->'items'),10,'search caps results per category');
SELECT is((public.workspace_search('предел')->>'has_more')::boolean,true,'search reports overflow explicitly');
SELECT ok(public.workspace_search('предел')::text NOT LIKE '%чужой%','authorization applied before result cap');
SELECT is(public.workspace_search('предел'),public.workspace_search('предел'),'limited result ordering is deterministic');
SELECT is(jsonb_array_length(public.workspace_search('5e500000-0000-4000-8000-000000000001')->'items'),1,'exact old request searchable after 210 newer requests');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.workspace_search_team_request('5e500000-0000-4000-8000-000000000001')->'request'->>'id','5e500000-0000-4000-8000-000000000001','exact team selection independent of last-200 cap');
RESET ROLE;
UPDATE public.team_memberships SET status='revoked' WHERE id='5e600000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('test.search',public.workspace_search('поиск')::text,true);
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000001') IS NULL,'revocation removes team property immediately');
SELECT ok(pg_temp.search_item('request','5e500000-0000-4000-8000-000000000001') IS NULL,'revocation removes team request immediately');
SELECT ok(public.workspace_search_team_request('5e500000-0000-4000-8000-000000000001') IS NULL,'revocation invalidates exact request read');
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000004') IS NOT NULL,'revocation retains independent owner rights');
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000005') IS NOT NULL,'revocation retains independent personal lease');
RESET ROLE;
-- Agreement visibility and property visibility have different lifecycle rules:
-- a tenant may read a future/expired active lease without exposing its property.
INSERT INTO public.properties(id,owner_id,name,address) VALUES
 ('5e200000-0000-4000-8000-000000000006','5e100000-0000-4000-8000-000000000001','FUTURE_PROPERTY_HIDDEN','FUTURE_ADDRESS_HIDDEN'),
 ('5e200000-0000-4000-8000-000000000007','5e100000-0000-4000-8000-000000000001','EXPIRED_PROPERTY_HIDDEN','EXPIRED_ADDRESS_HIDDEN'),
 ('5e200000-0000-4000-8000-000000000008','5e100000-0000-4000-8000-000000000001','PENDING_PROPERTY_VISIBLE','Pending address'),
 ('5e200000-0000-4000-8000-000000000009','5e100000-0000-4000-8000-000000000001','COMPLETED_PROPERTY_VISIBLE','Completed address');
INSERT INTO public.lease_agreements(id,owner_id,property_id,tenant_id,start_date,end_date,monthly_payment,status,signed_document_file) VALUES
 ('5e400000-0000-4000-8000-000000000006','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000006','5e300000-0000-4000-8000-000000000001',CURRENT_DATE+10,CURRENT_DATE+20,1000,'active','future-test.pdf'),
 ('5e400000-0000-4000-8000-000000000007','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000007','5e300000-0000-4000-8000-000000000001',CURRENT_DATE-20,CURRENT_DATE-10,1000,'active','expired-test.pdf'),
 ('5e400000-0000-4000-8000-000000000008','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000008','5e300000-0000-4000-8000-000000000001',CURRENT_DATE+10,CURRENT_DATE+20,1000,'pending_signature',NULL),
 ('5e400000-0000-4000-8000-000000000009','5e100000-0000-4000-8000-000000000001','5e200000-0000-4000-8000-000000000009','5e300000-0000-4000-8000-000000000001',CURRENT_DATE-20,CURRENT_DATE-10,1000,'completed','completed-test.pdf');
SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_array_length(public.workspace_search('FUTURE_PROPERTY_HIDDEN')->'items'),0,'future active property metadata is not searchable by tenant');
SELECT is(jsonb_array_length(public.workspace_search('EXPIRED_PROPERTY_HIDDEN')->'items'),0,'expired active property metadata is not searchable by tenant');
SELECT set_config('test.search',public.workspace_search('5e400000-0000-4000-8000-000000000006')::text,true);
SELECT ok(pg_temp.search_item('agreement','5e400000-0000-4000-8000-000000000006') IS NOT NULL,'future active personal contract remains searchable by id');
SELECT ok(current_setting('test.search') NOT LIKE '%FUTURE_PROPERTY_HIDDEN%' AND current_setting('test.search') NOT LIKE '%FUTURE_ADDRESS_HIDDEN%','future contract projection does not leak unavailable property metadata');
SELECT ok(jsonb_array_length(public.workspace_search('PENDING_PROPERTY_VISIBLE')->'items')>0,'pending signature permits its own property metadata');
SELECT ok(jsonb_array_length(public.workspace_search('COMPLETED_PROPERTY_VISIBLE')->'items')>0,'completed personal tenancy retains its permitted property metadata');
RESET ROLE;
-- Admin can switch an owner to the tenant cabinet without deleting old records.
-- Search must not advertise owner-directory or owner-contract screens that the
-- current cabinet cannot open. Independent personal tenancy remains available.
UPDATE public.user_roles SET role='tenant' WHERE user_id='5e100000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"5e100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.search',public.workspace_search('поиск')::text,true);
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_setting('test.search')::jsonb->'items') i WHERE i->>'kind'='tenant'),'changed tenant role is not offered inaccessible owner directory');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_setting('test.search')::jsonb->'items') i WHERE i->>'kind'='agreement'),'changed tenant role is not offered owner-only contracts in tenant cabinet');
SELECT ok(pg_temp.search_item('property','5e200000-0000-4000-8000-000000000001') IS NOT NULL,'role change does not remove independently accessible property hub');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
