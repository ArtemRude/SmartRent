SET lock_timeout='5s';
SET statement_timeout='30s';
-- Browser access is through scoped RPCs only; raw tables intentionally have no policies/grants.
CREATE TABLE public.property_listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
 unit_id uuid REFERENCES public.units(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','paused','filled')),
 draft jsonb NOT NULL DEFAULT '{}', published_snapshot jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX property_listings_space_idx ON public.property_listings(property_id,coalesce(unit_id,'00000000-0000-0000-0000-000000000000'));
CREATE INDEX property_listings_unit_idx ON public.property_listings(unit_id) WHERE unit_id IS NOT NULL;
CREATE TABLE public.rental_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES public.property_listings(id) ON DELETE RESTRICT,
 applicant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200), email text NOT NULL, phone text NOT NULL CHECK(length(btrim(phone)) BETWEEN 5 AND 40),
 message text NOT NULL DEFAULT '' CHECK(length(message)<=2000), offer jsonb NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','showing','shortlisted','accepted','rejected','withdrawn')),
 showing_at timestamptz, public_note text NOT NULL DEFAULT '' CHECK(length(public_note)<=2000),
 operator_note text NOT NULL DEFAULT '' CHECK(length(operator_note)<=2000),
 tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT, agreement_id uuid UNIQUE REFERENCES public.lease_agreements(id) ON DELETE RESTRICT,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(listing_id,applicant_id), CHECK(status<>'accepted' OR agreement_id IS NOT NULL)
);
CREATE INDEX rental_applications_applicant_idx ON public.rental_applications(applicant_id,created_at DESC,id);
CREATE INDEX rental_applications_listing_status_idx ON public.rental_applications(listing_id,status,created_at DESC,id);
CREATE INDEX rental_applications_tenant_idx ON public.rental_applications(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE TABLE public.recruitment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), listing_id uuid NOT NULL REFERENCES public.property_listings(id) ON DELETE RESTRICT,
 application_id uuid REFERENCES public.rental_applications(id) ON DELETE RESTRICT,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, action text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recruitment_events_listing_idx ON public.recruitment_events(listing_id,created_at DESC,id);
CREATE INDEX recruitment_events_application_idx ON public.recruitment_events(application_id) WHERE application_id IS NOT NULL;
CREATE INDEX recruitment_events_actor_idx ON public.recruitment_events(actor_id) WHERE actor_id IS NOT NULL;
ALTER TABLE public.property_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recruitment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_listings,public.rental_applications,public.recruitment_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.property_listings,public.rental_applications,public.recruitment_events TO service_role;

CREATE FUNCTION private.hub_role(p_property_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN auth.uid() IS NULL THEN NULL WHEN p.owner_id=auth.uid() OR private.has_role(auth.uid(),'admin') THEN 'owner'
 ELSE (SELECT m.role FROM public.team_memberships m JOIN public.team_property_access g ON g.membership_id=m.id WHERE m.owner_id=p.owner_id AND m.user_id=auth.uid() AND m.status='active' AND g.property_id=p.id) END FROM public.properties p WHERE p.id=p_property_id;
$$;
-- A published card is available only for a currently offered vacancy. Full-property offers conflict with every unit.
CREATE FUNCTION private.listing_is_available(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.property_listings l JOIN public.properties p ON p.id=l.property_id
 WHERE l.id=p_id AND l.status='published' AND p.status='active' AND l.published_snapshot IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.lease_agreements a WHERE a.property_id=p.id AND a.status IN ('active','pending_signature')
 AND (l.unit_id IS NULL OR a.unit_id IS NULL OR a.unit_id=l.unit_id) AND a.end_date>=greatest(CURRENT_DATE,(l.published_snapshot->>'available_from')::date))
 AND NOT EXISTS(SELECT 1 FROM public.rental_applications c JOIN public.property_listings other ON other.id=c.listing_id JOIN public.lease_agreements a ON a.id=c.agreement_id
 WHERE other.property_id=p.id AND (l.unit_id IS NULL OR other.unit_id IS NULL OR other.unit_id=l.unit_id) AND c.status='accepted' AND a.status<>'completed'));
$$;
CREATE FUNCTION private.public_listing(p_public_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('public_id',l.public_id,'published_at',l.published_at,'details',l.published_snapshot,'can_apply',auth.uid() IS NULL OR private.hub_role(l.property_id) IS NULL)
 FROM public.property_listings l WHERE l.public_id=p_public_id AND private.listing_is_available(l.id);
$$;
CREATE FUNCTION private.save_property_listing(p_property_id uuid,p_id uuid,p_unit_id uuid,p_values jsonb,p_revision integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.properties; l public.property_listings; v jsonb; photos text[]; path text;
BEGIN
 SELECT * INTO p FROM public.properties WHERE id=p_property_id;
 IF private.hub_role(p.id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Публикацией управляет собственник' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team:'||p.owner_id::text,0));
 PERFORM 1 FROM public.properties WHERE id=p.id FOR UPDATE;
 IF private.hub_role(p.id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Доступ изменён' USING ERRCODE='42501'; END IF;
 IF p_unit_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.units WHERE id=p_unit_id AND property_id=p.id) THEN RAISE EXCEPTION 'Помещение не принадлежит объекту' USING ERRCODE='22023'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO l FROM public.property_listings WHERE id=p_id AND property_id=p.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Публикация недоступна' USING ERRCODE='42501'; END IF;
  IF l.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Публикация уже изменена. Обновите страницу' USING ERRCODE='40001'; END IF;
  IF l.unit_id IS DISTINCT FROM p_unit_id THEN RAISE EXCEPTION 'Помещение публикации нельзя изменить' USING ERRCODE='23514'; END IF;
 ELSE
  IF p_revision IS NOT NULL THEN RAISE EXCEPTION 'Обновите страницу' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM public.property_listings WHERE property_id=p.id AND unit_id IS NOT DISTINCT FROM p_unit_id) THEN RAISE EXCEPTION 'Карточка для этого объекта или помещения уже существует. Измените её в списке публикаций' USING ERRCODE='23505'; END IF;
  INSERT INTO public.property_listings(property_id,unit_id) VALUES(p.id,p_unit_id) RETURNING * INTO l;
 END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR coalesce(length(btrim(p_values->>'title')),0) NOT BETWEEN 1 AND 200
 OR coalesce(length(btrim(p_values->>'location')),0) NOT BETWEEN 1 AND 300 OR length(coalesce(p_values->>'description',''))>4000 OR length(coalesce(p_values->>'contact_name',''))>200
 OR coalesce(p_values->>'monthly_rent','') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' OR (p_values->>'monthly_rent')::numeric<=0
 OR coalesce(p_values->>'deposit','') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'
 OR coalesce(p_values->>'area','') !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$'
 OR coalesce(p_values->>'available_from','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
 OR jsonb_typeof(p_values->'photos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_values->'photos')>8 THEN
 RAISE EXCEPTION 'Проверьте название, расположение, стоимость, дату и фотографии' USING ERRCODE='22023'; END IF;
 PERFORM (p_values->>'available_from')::date;
 SELECT coalesce(array_agg(x),'{}') INTO photos FROM jsonb_array_elements_text(p_values->'photos') x;
 FOREACH path IN ARRAY photos LOOP
  IF split_part(path,'/',1)<>l.public_id::text OR array_length(string_to_array(path,'/'),1)<>2 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='listing-photos' AND name=path) THEN
   RAISE EXCEPTION 'Фотография недоступна для этой публикации' USING ERRCODE='22023'; END IF;
 END LOOP;
 -- Explicit allowlist: private property fields, identities and arbitrary JSON never become public.
 v:=jsonb_build_object('title',btrim(p_values->>'title'),'location',btrim(p_values->>'location'),'description',coalesce(p_values->>'description',''),
 'monthly_rent',(p_values->>'monthly_rent')::numeric,'deposit',(p_values->>'deposit')::numeric,'area',(p_values->>'area')::numeric,
 'available_from',(p_values->>'available_from')::date,'contact_name',coalesce(p_values->>'contact_name',''),'photos',to_jsonb(photos));
 UPDATE public.property_listings SET draft=v,revision=revision+1,updated_at=now() WHERE id=l.id;
 INSERT INTO public.recruitment_events(listing_id,actor_id,action,detail) VALUES(l.id,auth.uid(),'draft_saved',v);
 RETURN l.id;
END;
$$;
CREATE FUNCTION private.act_on_property_listing(p_id uuid,p_action text,p_revision integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.property_listings; owner_id uuid;
BEGIN
 SELECT * INTO l FROM public.property_listings WHERE id=p_id;
 -- Resolve locks in the same owner -> property -> listing order used by team/recruitment writes.
 SELECT p.owner_id INTO owner_id FROM public.property_listings x JOIN public.properties p ON p.id=x.property_id WHERE x.id=p_id;
 IF private.hub_role(l.property_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Публикацией управляет собственник' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team:'||owner_id::text,0));
 PERFORM 1 FROM public.properties WHERE id=l.property_id FOR UPDATE;
 SELECT * INTO l FROM public.property_listings WHERE id=p_id FOR UPDATE;
 IF private.hub_role(l.property_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Доступ изменён' USING ERRCODE='42501'; END IF;
 IF l.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Публикация уже изменена. Обновите страницу' USING ERRCODE='40001'; END IF;
 IF p_action='publish' THEN
  IF l.draft='{}' OR jsonb_array_length(l.draft->'photos')<1 THEN RAISE EXCEPTION 'Добавьте хотя бы одну фотографию для публикации' USING ERRCODE='23514'; END IF;
  UPDATE public.property_listings SET status='published',published_snapshot=draft,published_at=now(),revision=revision+1,updated_at=now() WHERE id=l.id;
  IF NOT private.listing_is_available(l.id) THEN RAISE EXCEPTION 'Объект занят или уже выбран кандидат. Проверьте договоры и дату доступности' USING ERRCODE='23514'; END IF;
 ELSIF p_action='pause' AND l.status IN ('published','paused','draft') THEN
  UPDATE public.property_listings SET status='paused',revision=revision+1,updated_at=now() WHERE id=l.id;
 ELSE RAISE EXCEPTION 'Действие недоступно для публикации' USING ERRCODE='23514'; END IF;
 INSERT INTO public.recruitment_events(listing_id,actor_id,action,detail) VALUES(l.id,auth.uid(),p_action,l.draft);
 RETURN l.id;
END;
$$;
CREATE FUNCTION private.apply_to_listing(p_public_id uuid,p_values jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.property_listings; p public.properties; a public.rental_applications; verified_email text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.property_listings WHERE public_id=p_public_id;
 SELECT * INTO p FROM public.properties WHERE id=l.property_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Объявление недоступно' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team:'||p.owner_id::text,0));
 PERFORM 1 FROM public.properties WHERE id=p.id FOR UPDATE;
 SELECT * INTO l FROM public.property_listings WHERE id=l.id FOR UPDATE;
 IF NOT private.listing_is_available(l.id) OR p.owner_id=auth.uid() OR private.hub_role(p.id) IS NOT NULL THEN RAISE EXCEPTION 'Подать заявку на это объявление нельзя' USING ERRCODE='42501'; END IF;
 SELECT email INTO verified_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 IF verified_email IS NULL THEN RAISE EXCEPTION 'Подтвердите email перед подачей заявки' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR coalesce(length(btrim(p_values->>'name')),0) NOT BETWEEN 1 AND 200 OR coalesce(length(btrim(p_values->>'phone')),0) NOT BETWEEN 5 AND 40 OR length(coalesce(p_values->>'message',''))>2000 OR p_values->>'consent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Укажите имя, телефон и согласие передать контакты команде объекта' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.rental_applications WHERE listing_id=l.id AND applicant_id=auth.uid();
 IF FOUND THEN RETURN a.id; END IF;
 INSERT INTO public.rental_applications(listing_id,applicant_id,name,email,phone,message,offer) VALUES(l.id,auth.uid(),btrim(p_values->>'name'),verified_email,btrim(p_values->>'phone'),coalesce(p_values->>'message',''),l.published_snapshot) RETURNING * INTO a;
 INSERT INTO public.recruitment_events(listing_id,application_id,actor_id,action,detail) VALUES(l.id,a.id,auth.uid(),'applied','{}');
 INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id) VALUES(p.owner_id,'rental_application','Новый кандидат на аренду',left(l.published_snapshot->>'title',1000),'/recruitment','application',a.id);
 RETURN a.id;
END;
$$;
CREATE FUNCTION private.application_snapshot(p_id uuid,p_operator boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',a.id,'public_id',l.public_id,'listing_id',l.id,'property_id',l.property_id,'name',a.name,'email',a.email,'phone',a.phone,'message',a.message,
 'offer',a.offer,'status',a.status,'showing_at',a.showing_at,'public_note',a.public_note,'revision',a.revision,'created_at',a.created_at,
 'agreement_id',CASE WHEN p_operator THEN a.agreement_id END,'operator_note',CASE WHEN p_operator THEN a.operator_note END)
 FROM public.rental_applications a JOIN public.property_listings l ON l.id=a.listing_id WHERE a.id=p_id;
$$;
CREATE FUNCTION private.act_on_rental_application(p_id uuid,p_action text,p_revision integer,p_values jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.rental_applications; l public.property_listings; p public.properties; r text; start_on date; end_on date; tenant uuid; lease uuid; note text; showing timestamptz; due integer;
BEGIN
 SELECT * INTO a FROM public.rental_applications WHERE id=p_id;
 SELECT * INTO l FROM public.property_listings WHERE id=a.listing_id;
 SELECT * INTO p FROM public.properties WHERE id=l.property_id;
 IF auth.uid() IS NULL OR p.id IS NULL OR (a.applicant_id<>auth.uid() AND coalesce(private.hub_role(p.id),'') NOT IN ('owner','manager')) THEN RAISE EXCEPTION 'Заявка недоступна' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team:'||p.owner_id::text,0));
 PERFORM 1 FROM public.properties WHERE id=p.id FOR UPDATE;
 SELECT * INTO l FROM public.property_listings WHERE id=l.id FOR UPDATE;
 SELECT * INTO a FROM public.rental_applications WHERE id=p_id FOR UPDATE;
 r:=private.hub_role(p.id);
 IF a.applicant_id<>auth.uid() AND coalesce(r,'') NOT IN ('owner','manager') THEN RAISE EXCEPTION 'Доступ изменён' USING ERRCODE='42501'; END IF;
 IF p_action='accept' AND r='owner' AND a.status='accepted' THEN RETURN a.agreement_id; END IF;
 IF a.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Заявка уже изменена. Обновите страницу' USING ERRCODE='40001'; END IF;
 IF p_action='undo_selection' THEN
  IF r IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Выбор отменяет собственник' USING ERRCODE='42501'; END IF;
  IF a.status<>'accepted' OR coalesce(length(btrim(p_values->>'public_note')),0) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Выберите принятую заявку и укажите причину' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.lease_agreements x WHERE x.id=a.agreement_id AND x.status='draft' AND x.document_file IS NULL AND x.signed_document_file IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.agreement_acceptances WHERE agreement_id=x.id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Договор уже подготовлен или передан на подписание. Используйте раздел договоров' USING ERRCODE='23514'; END IF;
  INSERT INTO public.recruitment_events(listing_id,application_id,actor_id,action,detail) VALUES(l.id,a.id,auth.uid(),'undo_selection',private.application_snapshot(a.id,true)||jsonb_build_object('reason',p_values->>'public_note'));
  -- Keep the draft and tenant for audit; the owner can remove an unused draft in the existing contracts screen.
  UPDATE public.rental_applications SET status='rejected',public_note=p_values->>'public_note',agreement_id=NULL,revision=revision+1,updated_at=now() WHERE id=a.id;
  UPDATE public.property_listings SET status='paused',revision=revision+1,updated_at=now() WHERE id=l.id;
  INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id) VALUES(a.applicant_id,'rental_application','Выбор кандидата отменён',left(p_values->>'public_note',1000),'/recruitment','application',a.id);
  RETURN a.id;
 END IF;
 IF a.status NOT IN ('new','showing','shortlisted') THEN RAISE EXCEPTION 'Заявка уже завершена' USING ERRCODE='23514'; END IF;
 note:=coalesce(p_values->>'public_note','');
 IF length(note)>2000 OR length(coalesce(p_values->>'operator_note',''))>2000 THEN RAISE EXCEPTION 'Примечание слишком длинное' USING ERRCODE='22023'; END IF;
 IF p_action='withdraw' AND a.applicant_id=auth.uid() THEN
  UPDATE public.rental_applications SET status='withdrawn',revision=revision+1,updated_at=now() WHERE id=a.id;
 ELSIF coalesce(r,'') NOT IN ('owner','manager') THEN RAISE EXCEPTION 'Действие доступно команде объекта' USING ERRCODE='42501';
 ELSIF p_action='schedule' THEN
  showing:=(p_values->>'showing_at')::timestamptz;
  IF showing IS NULL OR showing<=now() OR showing>now()+interval '1 year' THEN RAISE EXCEPTION 'Укажите будущие дату и время показа' USING ERRCODE='22023'; END IF;
  UPDATE public.rental_applications SET status='showing',showing_at=showing,public_note=note,operator_note=coalesce(p_values->>'operator_note',operator_note),revision=revision+1,updated_at=now() WHERE id=a.id;
 ELSIF p_action IN ('shortlist','reject','note') THEN
  IF p_action='reject' AND btrim(note)='' THEN RAISE EXCEPTION 'Укажите сообщение кандидату' USING ERRCODE='22023'; END IF;
  UPDATE public.rental_applications SET status=CASE p_action WHEN 'shortlist' THEN 'shortlisted' WHEN 'reject' THEN 'rejected' ELSE status END,public_note=note,operator_note=coalesce(p_values->>'operator_note',operator_note),revision=revision+1,updated_at=now() WHERE id=a.id;
 ELSIF p_action='accept' THEN
  IF r<>'owner' THEN RAISE EXCEPTION 'Кандидата выбирает собственник' USING ERRCODE='42501'; END IF;
  start_on:=(p_values->>'start_date')::date; end_on:=(p_values->>'end_date')::date; due:=(p_values->>'payment_due_day')::integer;
  IF p.status<>'active' OR start_on IS NULL OR end_on IS NULL OR due IS NULL OR due NOT BETWEEN 1 AND 31 OR start_on<greatest(CURRENT_DATE,(a.offer->>'available_from')::date) OR end_on<start_on OR end_on>'2099-12-31' THEN RAISE EXCEPTION 'Проверьте даты договора и день оплаты' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.lease_agreements x WHERE x.property_id=p.id AND x.status IN ('active','pending_signature') AND (l.unit_id IS NULL OR x.unit_id IS NULL OR x.unit_id=l.unit_id) AND x.start_date<=end_on AND x.end_date>=start_on)
   OR EXISTS(SELECT 1 FROM public.rental_applications c JOIN public.property_listings other ON other.id=c.listing_id JOIN public.lease_agreements x ON x.id=c.agreement_id WHERE other.property_id=p.id AND c.status='accepted' AND x.status<>'completed' AND (l.unit_id IS NULL OR other.unit_id IS NULL OR other.unit_id=l.unit_id)) THEN RAISE EXCEPTION 'Помещение уже занято или выбран другой кандидат' USING ERRCODE='23514'; END IF;
  SELECT id INTO tenant FROM public.tenants WHERE owner_id=p.owner_id AND user_id=a.applicant_id ORDER BY created_at,id LIMIT 1;
  IF tenant IS NULL THEN
   SELECT id INTO tenant FROM public.tenants WHERE owner_id=p.owner_id AND user_id IS NULL AND lower(email)=lower(a.email) ORDER BY created_at,id LIMIT 1 FOR UPDATE;
   IF tenant IS NULL THEN INSERT INTO public.tenants(owner_id,user_id,name,email,phone) VALUES(p.owner_id,a.applicant_id,a.name,a.email,a.phone) RETURNING id INTO tenant;
   ELSE UPDATE public.tenants SET user_id=a.applicant_id WHERE id=tenant; END IF;
  END IF;
  INSERT INTO public.lease_agreements(owner_id,property_id,unit_id,tenant_id,start_date,end_date,monthly_payment,contract_details,payment_due_day,status)
   VALUES(p.owner_id,p.id,l.unit_id,tenant,start_on,end_on,(a.offer->>'monthly_rent')::numeric,jsonb_build_object('depositAmount',(a.offer->>'deposit')::numeric,'paymentDueDay',due),due,'draft') RETURNING id INTO lease;
  UPDATE public.rental_applications SET status='accepted',tenant_id=tenant,agreement_id=lease,public_note=note,revision=revision+1,updated_at=now() WHERE id=a.id;
  UPDATE public.property_listings SET status='filled',revision=revision+1,updated_at=now() WHERE id=l.id;
  -- Other candidates remain available for another unit; this offer is closed explicitly.
  INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id)
   SELECT applicant_id,'rental_application','Набор по объявлению завершён','Собственник выбрал кандидата.','/recruitment','application',id FROM public.rental_applications WHERE listing_id=l.id AND id<>a.id AND status IN ('new','showing','shortlisted');
  UPDATE public.rental_applications SET status='rejected',public_note='Набор завершён: собственник выбрал кандидата.',revision=revision+1,updated_at=now() WHERE listing_id=l.id AND id<>a.id AND status IN ('new','showing','shortlisted');
 ELSE RAISE EXCEPTION 'Действие недоступно' USING ERRCODE='23514'; END IF;
 INSERT INTO public.recruitment_events(listing_id,application_id,actor_id,action,detail) VALUES(l.id,a.id,auth.uid(),p_action,private.application_snapshot(a.id,true));
 INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id) VALUES(CASE WHEN p_action='withdraw' THEN p.owner_id ELSE a.applicant_id END,'rental_application','Заявка на аренду обновлена',left(a.offer->>'title',1000),'/recruitment','application',a.id);
 RETURN coalesce(lease,a.id);
END;
$$;
CREATE FUNCTION private.property_hub(p_property_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r text; result jsonb;
BEGIN
 r:=private.hub_role(p_property_id);
 IF r IS NULL THEN RAISE EXCEPTION 'Объект недоступен. Проверьте приглашение в команду' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('property',jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'description',p.description,'status',p.status,'role',r,'owner_id',p.owner_id),
 'workspace',CASE WHEN private.team_has_access(p.id,false) THEN private.team_workspace(p.id) END,
 'units',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'status',u.status,'area',u.area) ORDER BY u.name,u.id) FROM public.units u WHERE u.property_id=p.id),'[]'),
 'repairs',coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC,j.id) FROM (SELECT id,title,status,due_date,created_at FROM public.repair_jobs WHERE property_id=p.id ORDER BY created_at DESC,id LIMIT 20) j),'[]'),
 'open_requests',(SELECT count(*) FROM public.requests WHERE property_id=p.id AND status<>'closed'),
 'showing_count',(SELECT count(*) FROM public.rental_applications a JOIN public.property_listings l ON l.id=a.listing_id WHERE l.property_id=p.id AND a.status='showing' AND a.showing_at>=now()),
 'repair_count',(SELECT count(*) FROM public.repair_jobs WHERE property_id=p.id AND status NOT IN ('completed','cancelled')),
 'listings',coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('has_changes',l.draft IS DISTINCT FROM l.published_snapshot,'available',private.listing_is_available(l.id)) ORDER BY l.created_at DESC,l.id) FROM public.property_listings l WHERE l.property_id=p.id),'[]'),
 'applications',CASE WHEN r IN ('owner','manager') THEN coalesce((SELECT jsonb_agg(private.application_snapshot(a.id,true) ORDER BY a.created_at DESC,a.id) FROM (SELECT c.id,c.created_at FROM public.rental_applications c JOIN public.property_listings l ON l.id=c.listing_id WHERE l.property_id=p.id ORDER BY c.created_at DESC,c.id LIMIT 200) a),'[]') ELSE '[]'::jsonb END,
 'application_count',(SELECT count(*) FROM public.rental_applications a JOIN public.property_listings l ON l.id=a.listing_id WHERE l.property_id=p.id AND a.status IN ('new','showing','shortlisted')),
 'applications_truncated',(SELECT count(*)>200 FROM public.rental_applications a JOIN public.property_listings l ON l.id=a.listing_id WHERE l.property_id=p.id),
 'events',CASE WHEN r IN ('owner','manager') THEN coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC,e.id) FROM (SELECT e.id,e.action,e.application_id,e.created_at FROM public.recruitment_events e JOIN public.property_listings l ON l.id=e.listing_id WHERE l.property_id=p.id ORDER BY e.created_at DESC,e.id LIMIT 50) e),'[]') ELSE '[]'::jsonb END)
 INTO result FROM public.properties p WHERE p.id=p_property_id;
 RETURN result;
END;
$$;
CREATE FUNCTION private.recruitment_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('properties',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.name,p.id) FROM (SELECT id,name,address,private.hub_role(id) role FROM public.properties WHERE private.hub_role(id) IS NOT NULL ORDER BY name,id LIMIT 200) p),'[]'),
 'applications',coalesce((SELECT jsonb_agg(private.application_snapshot(a.id,false) ORDER BY a.created_at DESC,a.id) FROM (SELECT id,created_at FROM public.rental_applications WHERE applicant_id=auth.uid() ORDER BY created_at DESC,id LIMIT 200) a),'[]'),
 'properties_truncated',(SELECT count(*)>200 FROM public.properties WHERE private.hub_role(id) IS NOT NULL),
 'applications_truncated',(SELECT count(*)>200 FROM public.rental_applications WHERE applicant_id=auth.uid()));
END;
$$;
CREATE FUNCTION private.listing_photo_access(p_path text,p_write boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.property_listings; target_public_id uuid;
BEGIN
 IF array_length(string_to_array(p_path,'/'),1)<>2 THEN RETURN false; END IF;
 BEGIN target_public_id:=split_part(p_path,'/',1)::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
 SELECT * INTO l FROM public.property_listings WHERE property_listings.public_id=target_public_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF private.hub_role(l.property_id)='owner' THEN RETURN true; END IF;
 IF p_write THEN RETURN false; END IF;
 RETURN private.listing_is_available(l.id) AND l.published_snapshot->'photos' ? p_path;
END;
$$;
-- Protect the stable scope of private history, including uploads and applicant contacts.
CREATE FUNCTION private.protect_listing_relations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='properties' THEN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND EXISTS(SELECT 1 FROM public.property_listings WHERE property_id=OLD.id) THEN RAISE EXCEPTION 'Объект с публикациями нельзя передать другому собственнику' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='units' THEN
  IF NEW.property_id IS DISTINCT FROM OLD.property_id AND EXISTS(SELECT 1 FROM public.property_listings WHERE unit_id=OLD.id) THEN RAISE EXCEPTION 'Помещение с публикацией нельзя перенести' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER protect_listing_owner BEFORE UPDATE OF owner_id ON public.properties FOR EACH ROW EXECUTE FUNCTION private.protect_listing_relations();
CREATE TRIGGER protect_listing_unit BEFORE UPDATE OF property_id ON public.units FOR EACH ROW EXECUTE FUNCTION private.protect_listing_relations();
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('listing-photos','listing-photos',false,8388608,ARRAY['image/jpeg','image/png','image/webp']);
CREATE POLICY listing_photos_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='listing-photos' AND private.listing_photo_access(name,true));
CREATE POLICY listing_photos_read ON storage.objects FOR SELECT TO anon,authenticated USING(bucket_id='listing-photos' AND private.listing_photo_access(name,false));
-- No client deletes/replacements: photos already approved for publication/audit remain immutable.
GRANT SELECT ON storage.objects TO anon;
GRANT USAGE ON SCHEMA private TO anon;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_valid CHECK(entity_type IN ('request','agreement','rent_charge','repair','application'));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid CHECK(kind IN ('request_created','request_comment','request_status','agreement_created','agreement_status','agreement_accepted','agreement_expiring','payment_status','payment_due','payment_overdue','payment_reminder','payment_reported','payment_report_status','utility_submitted','utility_reviewed','handover_status','agreement_amendment','repair_status','rental_application'));

CREATE FUNCTION public.public_listing(p_public_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.public_listing(p_public_id);$$;
CREATE FUNCTION public.property_hub(p_property_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.property_hub(p_property_id);$$;
CREATE FUNCTION public.recruitment_overview() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.recruitment_overview();$$;
CREATE FUNCTION public.save_property_listing(p_property_id uuid,p_id uuid,p_unit_id uuid,p_values jsonb,p_revision integer) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.save_property_listing(p_property_id,p_id,p_unit_id,p_values,p_revision);$$;
CREATE FUNCTION public.act_on_property_listing(p_id uuid,p_action text,p_revision integer) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.act_on_property_listing(p_id,p_action,p_revision);$$;
CREATE FUNCTION public.apply_to_listing(p_public_id uuid,p_values jsonb) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.apply_to_listing(p_public_id,p_values);$$;
CREATE FUNCTION public.act_on_rental_application(p_id uuid,p_action text,p_revision integer,p_values jsonb DEFAULT '{}') RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.act_on_rental_application(p_id,p_action,p_revision,p_values);$$;
REVOKE ALL ON FUNCTION private.hub_role(uuid),private.listing_is_available(uuid),private.application_snapshot(uuid,boolean),private.protect_listing_relations() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.public_listing(uuid),public.public_listing(uuid),private.listing_photo_access(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.public_listing(uuid),public.public_listing(uuid),private.listing_photo_access(text,boolean) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.property_hub(uuid),public.property_hub(uuid),private.recruitment_overview(),public.recruitment_overview(),private.save_property_listing(uuid,uuid,uuid,jsonb,integer),public.save_property_listing(uuid,uuid,uuid,jsonb,integer),private.act_on_property_listing(uuid,text,integer),public.act_on_property_listing(uuid,text,integer),private.apply_to_listing(uuid,jsonb),public.apply_to_listing(uuid,jsonb),private.act_on_rental_application(uuid,text,integer,jsonb),public.act_on_rental_application(uuid,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.property_hub(uuid),public.property_hub(uuid),private.recruitment_overview(),public.recruitment_overview(),private.save_property_listing(uuid,uuid,uuid,jsonb,integer),public.save_property_listing(uuid,uuid,uuid,jsonb,integer),private.act_on_property_listing(uuid,text,integer),public.act_on_property_listing(uuid,text,integer),private.apply_to_listing(uuid,jsonb),public.apply_to_listing(uuid,jsonb),private.act_on_rental_application(uuid,text,integer,jsonb),public.act_on_rental_application(uuid,text,integer,jsonb) TO authenticated,service_role;
