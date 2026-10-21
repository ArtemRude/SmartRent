BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
 ('c1000000-0000-0000-0000-000000000001','catalog-owner@example.invalid',now(),'{"name":"Owner","role":"owner"}'),
 ('c1000000-0000-0000-0000-000000000002','catalog-other@example.invalid',now(),'{"name":"Other","role":"owner"}'),
 ('c1000000-0000-0000-0000-000000000003','catalog-manager@example.invalid',now(),'{"name":"Manager","role":"tenant"}'),
 ('c1000000-0000-0000-0000-000000000004','catalog-viewer@example.invalid',now(),'{"name":"Viewer","role":"tenant"}'),
 ('c1000000-0000-0000-0000-000000000005','catalog-applicant@example.invalid',now(),'{"name":"Applicant","role":"tenant"}');
INSERT INTO public.properties(id,owner_id,name,address,description,type,photos) VALUES
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','PRIVATE_NAME','PRIVATE_LOCATION','PRIVATE_NOTES','apartment',ARRAY['c1000000-0000-0000-0000-000000000001/property-cover.png']),
 ('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','Warehouse','North district','Clean warehouse','warehouse','{}'),
 ('c2000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002','FOREIGN_NAME','FOREIGN_ADDRESS','FOREIGN_NOTES','commercial','{}');
INSERT INTO public.units(id,property_id,name,area) VALUES
 ('c3000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','101',42),
 ('c3000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000002','First',100);
INSERT INTO public.team_memberships(id,owner_id,email,user_id,role,status) VALUES
 ('c4000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','catalog-manager@example.invalid','c1000000-0000-0000-0000-000000000003','manager','active'),
 ('c4000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','catalog-viewer@example.invalid','c1000000-0000-0000-0000-000000000004','viewer','active');
INSERT INTO public.team_property_access VALUES ('c4000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001'),('c4000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000001');
INSERT INTO storage.objects(bucket_id,name) VALUES('property-photos','c1000000-0000-0000-0000-000000000001/property-cover.png');
INSERT INTO public.property_listings(id,public_id,property_id,status,draft,published_snapshot,published_at) VALUES
 ('c5000000-0000-0000-0000-000000000001','c9000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','published','{"title":"UNPUBLISHED_DRAFT"}',jsonb_build_object('title','Светлая квартира','location','Park district','description','Balcony','monthly_rent',45000,'area',42,'deposit',45000,'available_from',CURRENT_DATE,'photos',jsonb_build_array('c9000000-0000-0000-0000-000000000001/cover.png')),now()),
 ('c5000000-0000-0000-0000-000000000002','c9000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000002','draft','{"title":"PRIVATE_DRAFT"}',NULL,NULL);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
SELECT is((public.public_property_catalog()->>'total')::integer,1,'anonymous catalog contains only an available publication');
SELECT ok(public.public_property_catalog()::text NOT LIKE '%PRIVATE_%' AND public.public_property_catalog()::text NOT LIKE '%FOREIGN_%' AND public.public_property_catalog()::text NOT LIKE '%UNPUBLISHED_%' AND public.public_property_catalog()::text NOT LIKE '%owner_id%' AND public.public_property_catalog()::text NOT LIKE '%property_id%','public catalog contains no private identities fields or drafts');
SELECT is(public.public_property_catalog()->'items'->0->>'id','c9000000-0000-0000-0000-000000000001','public URLs use public ID');
SELECT is((public.public_property_catalog('{"q":"PRIVATE_LOCATION"}')->>'total')::integer,0,'public search cannot discover private address');
SELECT is((public.public_property_catalog('{"q":"Park"}')->>'total')::integer,1,'public search uses public location');
SELECT is((public.public_property_catalog('{"q":"СВЕТЛАЯ"}')->>'total')::integer,1,'Russian search ignores case');
SELECT is((public.public_property_catalog('{"type":"warehouse"}')->>'total')::integer,0,'type filter respects public dataset');
SELECT is((public.public_property_catalog('{"price_max":"44000"}')->>'total')::integer,0,'price filter applied in database');
SELECT is((public.public_property_catalog('{"area_min":"42","area_max":"42"}')->>'total')::integer,1,'area boundaries are inclusive');
SELECT throws_ok($$SELECT public.property_catalog()$$,'42501',NULL,'anonymous cannot call internal wrapper');
SELECT throws_ok($$SELECT private.property_catalog(false,'{}',null)$$,'42501',NULL,'anonymous cannot bypass public adapter with false selector');
SELECT throws_ok($$SELECT private.catalog_rows(false)$$,'42501',NULL,'raw read model is inaccessible');
SELECT throws_ok($$SELECT public.public_property_catalog('{"price_min":100,"price_max":50}')$$,'22023',NULL,'inverted range rejected');
SELECT throws_ok($$SELECT public.public_property_catalog('{"sort":"price;drop table properties"}')$$,'22023',NULL,'sort injection rejected');
SELECT throws_ok($$SELECT public.public_property_catalog('{"price_min":"NaN"}')$$,'22023',NULL,'NaN rejected');
SELECT throws_ok($$SELECT public.public_property_catalog('{}','{"sort":"newest","rank":0,"number":0,"text":""}')$$,'22023',NULL,'incomplete cursor rejected');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT is((public.property_catalog()->>'total')::integer,2,'owner sees own properties only');
SELECT is((public.property_catalog('{"q":"PRIVATE_LOCATION"}')->>'total')::integer,1,'internal search sees authorized private address');
SELECT is((public.property_catalog('{"type":"warehouse"}')->>'total')::integer,1,'internal type filter');
SELECT is((public.property_catalog('{"publication":"published"}')->>'total')::integer,1,'internal publication filter uses actual public availability');
SELECT is(public.property_catalog('{"sort":"price_asc"}')->'items'->0->>'title','PRIVATE_NAME','known prices sort before unknown prices');
SELECT is(public.property_catalog('{"sort":"price_desc"}')->'items'->0->>'title','PRIVATE_NAME','unknown prices stay last descending too');
SELECT is(public.property_catalog('{"sort":"area_desc"}')->'items'->0->>'title','Warehouse','area sorting works');
SELECT is((public.property_catalog('{"q":"PRIVATE_NAME"}')->'items'->0->>'area')::numeric,42::numeric,'area reuses unit data');
SELECT throws_ok($$SELECT public.set_catalog_property_status('c2000000-0000-0000-0000-000000000001','archived','archived')$$,'40001',NULL,'stale property state rejected');
SELECT lives_ok($$SELECT public.set_catalog_property_status('c2000000-0000-0000-0000-000000000001','active','archived')$$,'owner can archive without deleting');
SELECT is((public.property_catalog('{"status":"archived"}')->>'total')::integer,1,'archived state is filterable');
SELECT is((public.public_property_catalog()->>'total')::integer,0,'archiving removes public offering');
SELECT lives_ok($$SELECT public.set_catalog_property_status('c2000000-0000-0000-0000-000000000001','archived','active')$$,'owner can restore');
SELECT is((public.public_property_catalog()->>'total')::integer,0,'restore does not automatically republish');
RESET ROLE;
SELECT is((SELECT status FROM public.property_listings WHERE id='c5000000-0000-0000-0000-000000000001'),'paused','archive pauses listing with new revision');
SELECT is((SELECT count(*) FROM public.team_activity WHERE property_id='c2000000-0000-0000-0000-000000000001'),2::bigint,'state changes retained in team history');
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-000000000003","user_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT is((public.property_catalog()->>'total')::integer,1,'tenant-role manager sees selected property in catalog');
SELECT ok(public.property_catalog()::text NOT LIKE '%Warehouse%' AND public.property_catalog()::text NOT LIKE '%FOREIGN_%','team catalog does not leak unassigned properties');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='property-photos'),1::bigint,'selected team can read property photo');
SELECT throws_ok($$INSERT INTO storage.objects(bucket_id,name) VALUES('property-photos','c1000000-0000-0000-0000-000000000001/manager-upload.png')$$,'42501',NULL,'team photo read grant does not grant uploads to owner folder');
SELECT throws_ok($$SELECT public.set_catalog_property_status('c2000000-0000-0000-0000-000000000001','active','archived')$$,'42501',NULL,'manager cannot archive with forged metadata');
RESET ROLE;
UPDATE public.team_memberships SET status='revoked' WHERE id='c4000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT is((public.property_catalog()->>'total')::integer,0,'revocation removes catalog item immediately');
SELECT is((SELECT count(*) FROM storage.objects WHERE bucket_id='property-photos'),0::bigint,'revocation removes team photo access');
RESET ROLE;
INSERT INTO public.tenants(id,owner_id,name) VALUES ('c8000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Existing renter');
INSERT INTO public.lease_agreements(id,owner_id,property_id,tenant_id,start_date,end_date,monthly_payment,status,signed_document_file) VALUES
 ('c8000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002','c8000000-0000-0000-0000-000000000001',CURRENT_DATE,CURRENT_DATE+365,120000,'active','owner/warehouse.pdf');
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-000000000001"}',true);
SET LOCAL ROLE authenticated;
SELECT is((public.property_catalog('{"occupancy":"leased"}')->>'total')::integer,1,'occupancy uses actual current lease');
SELECT is((public.property_catalog('{"type":"warehouse"}')->'items'->0->>'price')::numeric,120000::numeric,'catalog reuses existing rent calculation for occupied property');
SELECT set_config('test.catalog_charges',(SELECT count(*)::text FROM public.rent_charges WHERE agreement_id='c8000000-0000-0000-0000-000000000002'),true);
SELECT public.set_catalog_property_status('c2000000-0000-0000-0000-000000000002','active','archived');
SELECT is((SELECT count(*)::text FROM public.rent_charges WHERE agreement_id='c8000000-0000-0000-0000-000000000002'),current_setting('test.catalog_charges'),'archiving preserves billing');
SELECT is((SELECT status FROM public.lease_agreements WHERE id='c8000000-0000-0000-0000-000000000002'),'active','archiving does not complete lease');
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name) VALUES('property-photos','c1000000-0000-0000-0000-000000000002/foreign-secret.png');
UPDATE public.properties SET photos=ARRAY['c1000000-0000-0000-0000-000000000002/foreign-secret.png'] WHERE id='c2000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-000000000004"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM storage.objects WHERE name='c1000000-0000-0000-0000-000000000002/foreign-secret.png'),0::bigint,'copying a foreign photo path to a selected property cannot authorize its contents');
RESET ROLE;
-- More than one API page, deterministic ties, and exact microsecond ordering.
INSERT INTO public.properties(id,owner_id,name,created_at)
 SELECT ('c6000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'c1000000-0000-0000-0000-000000000002','Paged '||lpad(i::text,3,'0'),'2026-01-01 00:00:00+00'::timestamptz+i*interval '1 microsecond' FROM generate_series(1,53) i;
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-000000000002"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('test.catalog_page',public.property_catalog('{"q":"Paged"}')::text,true);
SELECT is(jsonb_array_length(current_setting('test.catalog_page')::jsonb->'items'),24,'catalog page bounded to 24 items');
SELECT is((current_setting('test.catalog_page')::jsonb->>'total')::integer,53,'count includes all results');
SELECT ok(current_setting('test.catalog_page')::jsonb->'next_cursor' IS NOT NULL,'more pages use explicit cursor');
SELECT is(current_setting('test.catalog_page')::jsonb->'items'->0->>'title','Paged 053','newest preserves microsecond ordering');
SELECT set_config('test.catalog_page2',public.property_catalog('{"q":"Paged"}',current_setting('test.catalog_page')::jsonb->'next_cursor')::text,true);
SELECT is(current_setting('test.catalog_page2')::jsonb->'items'->0->>'title','Paged 029','second page starts after exact previous microsecond');
SELECT set_config('test.catalog_page3',public.property_catalog('{"q":"Paged"}',current_setting('test.catalog_page2')::jsonb->'next_cursor')::text,true);
SELECT is(jsonb_array_length(current_setting('test.catalog_page3')::jsonb->'items'),5,'final page has remaining rows');
SELECT ok(current_setting('test.catalog_page3')::jsonb->'next_cursor'='null'::jsonb,'final page has no next cursor');
SELECT throws_ok($$SELECT public.property_catalog('{"sort":"name"}',current_setting('test.catalog_page')::jsonb->'next_cursor')$$,'22023',NULL,'cursor cannot be reused with a different sort');
RESET ROLE;
INSERT INTO public.properties(id,owner_id,name)
 SELECT ('c7000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'c1000000-0000-0000-0000-000000000002','Beyond '||lpad(i::text,4,'0') FROM generate_series(1,1005) i;
SET LOCAL ROLE authenticated;
SELECT is((public.property_catalog('{"q":"Beyond"}')->>'total')::integer,1005,'count is not silently truncated at a thousand rows');
SELECT is((public.property_catalog('{"q":"Beyond 1005"}')->>'total')::integer,1,'server search finds property beyond first thousand');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
