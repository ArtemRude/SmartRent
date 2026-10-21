SET lock_timeout = '5s';
SET statement_timeout = '30s';
CREATE TABLE public.repair_contractors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200), specialty text NOT NULL DEFAULT '' CHECK(length(specialty)<=100),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=40), email text NOT NULL DEFAULT '' CHECK(length(email)<=254),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=2000), active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repair_contractors_owner_idx ON public.repair_contractors(owner_id,name,id);
CREATE TABLE public.repair_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid REFERENCES public.requests(id) ON DELETE RESTRICT,
 contractor_id uuid REFERENCES public.repair_contractors(id) ON DELETE RESTRICT, contractor_snapshot jsonb,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 scheduled_date date NOT NULL, due_date date NOT NULL CHECK(due_date BETWEEN '2000-01-01' AND '2100-12-31'),
 estimate_items jsonb NOT NULL CHECK(jsonb_typeof(estimate_items)='array'), estimated_total numeric(14,2) NOT NULL CHECK(estimated_total>0 AND estimated_total<1000000000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','in_progress','review','completed','cancelled')),
 actual_amount numeric(14,2) CHECK(actual_amount>0 AND actual_amount<1000000000), result_note text NOT NULL DEFAULT '' CHECK(length(result_note)<=2000),
 result_photos text[] NOT NULL DEFAULT '{}', decision_note text NOT NULL DEFAULT '' CHECK(length(decision_note)<=2000),
 expense_id uuid UNIQUE REFERENCES public.property_expenses(id) ON DELETE RESTRICT,
 published_at timestamptz, completed_at timestamptz, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(scheduled_date BETWEEN '2000-01-01' AND due_date), CHECK(cardinality(result_photos)<=8),
 CHECK(status NOT IN ('review','completed') OR (actual_amount IS NOT NULL AND length(btrim(result_note))>0 AND cardinality(result_photos)>0))
);
CREATE INDEX repair_jobs_property_idx ON public.repair_jobs(property_id,created_at DESC,id);
CREATE INDEX repair_jobs_owner_idx ON public.repair_jobs(owner_id,created_at DESC,id);
CREATE INDEX repair_jobs_contractor_idx ON public.repair_jobs(contractor_id) WHERE contractor_id IS NOT NULL;
CREATE INDEX repair_jobs_request_idx ON public.repair_jobs(request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX repair_jobs_one_request_idx ON public.repair_jobs(request_id) WHERE request_id IS NOT NULL AND status<>'cancelled';
CREATE INDEX repair_jobs_photos_idx ON public.repair_jobs USING gin(result_photos);
CREATE TABLE public.repair_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.repair_jobs(id) ON DELETE RESTRICT,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, action text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repair_events_job_idx ON public.repair_events(job_id,created_at DESC,id);
CREATE INDEX repair_events_actor_idx ON public.repair_events(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX repair_events_photos_idx ON public.repair_events USING gin((snapshot->'result_photos'));
ALTER TABLE public.repair_contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.repair_contractors,public.repair_jobs,public.repair_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.repair_contractors,public.repair_jobs,public.repair_events TO service_role;

CREATE FUNCTION private.repair_property_role(p_property_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN auth.uid() IS NULL THEN NULL
 WHEN p.owner_id=auth.uid() OR private.has_role(auth.uid(),'admin') THEN 'owner'
 ELSE coalesce((SELECT m.role FROM public.team_memberships m JOIN public.team_property_access g ON g.membership_id=m.id
   WHERE m.owner_id=p.owner_id AND m.user_id=auth.uid() AND m.status='active' AND g.property_id=p.id),
   CASE WHEN EXISTS(SELECT 1 FROM public.repair_jobs j JOIN public.requests r ON r.id=j.request_id JOIN public.tenants t ON t.id=r.tenant_id
    WHERE j.property_id=p.id AND j.owner_id=p.owner_id AND j.published_at IS NOT NULL AND t.user_id=auth.uid()) THEN 'tenant' END) END
 FROM public.properties p WHERE p.id=p_property_id;
$$;
CREATE FUNCTION private.repair_job_access(p_id uuid,p_write boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.repair_jobs j JOIN public.properties p ON p.id=j.property_id AND p.owner_id=j.owner_id
 WHERE j.id=p_id AND (private.repair_property_role(p.id)='owner'
  OR (private.repair_property_role(p.id) IN ('manager','viewer') AND (NOT p_write OR private.repair_property_role(p.id)='manager'))
  OR (NOT p_write AND j.published_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.requests r JOIN public.tenants t ON t.id=r.tenant_id WHERE r.id=j.request_id AND r.owner_id=j.owner_id AND t.user_id=auth.uid()))));
$$;
REVOKE ALL ON FUNCTION private.repair_property_role(uuid),private.repair_job_access(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.repair_job_access(uuid,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION private.repair_property_role(uuid) FROM authenticated,service_role;

CREATE FUNCTION private.save_repair_contractor(p_owner_id uuid,p_id uuid,p_values jsonb,p_revision integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.repair_contractors;
BEGIN
 IF auth.uid() IS NULL OR NOT (private.has_role(auth.uid(),'admin') OR (auth.uid()=p_owner_id AND private.has_role(auth.uid(),'owner'))) THEN
  RAISE EXCEPTION 'Справочником исполнителей управляет собственник' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team:'||p_owner_id::text,0));
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR coalesce(length(btrim(p_values->>'name')),0) NOT BETWEEN 1 AND 200
  OR length(coalesce(p_values->>'specialty',''))>100 OR length(coalesce(p_values->>'phone',''))>40 OR length(coalesce(p_values->>'email',''))>254 OR length(coalesce(p_values->>'note',''))>2000
  OR (coalesce(p_values->>'email','')<>'' AND p_values->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
  RAISE EXCEPTION 'Проверьте имя и контакты исполнителя' USING ERRCODE='22023'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO c FROM public.repair_contractors WHERE id=p_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Исполнитель недоступен' USING ERRCODE='42501'; END IF;
  IF c.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Исполнитель уже изменён. Обновите страницу' USING ERRCODE='40001'; END IF;
  UPDATE public.repair_contractors SET name=btrim(p_values->>'name'),specialty=coalesce(p_values->>'specialty',''),phone=coalesce(p_values->>'phone',''),email=coalesce(p_values->>'email',''),note=coalesce(p_values->>'note',''),active=coalesce((p_values->>'active')::boolean,true),revision=revision+1 WHERE id=c.id RETURNING * INTO c;
 ELSE
  IF p_revision IS NOT NULL THEN RAISE EXCEPTION 'Исполнитель уже изменён' USING ERRCODE='40001'; END IF;
  INSERT INTO public.repair_contractors(owner_id,name,specialty,phone,email,note) VALUES(p_owner_id,btrim(p_values->>'name'),coalesce(p_values->>'specialty',''),coalesce(p_values->>'phone',''),coalesce(p_values->>'email',''),coalesce(p_values->>'note','')) RETURNING * INTO c;
 END IF;
 RETURN c.id;
END;
$$;

CREATE FUNCTION private.record_repair_event(p_id uuid,p_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.repair_jobs; tenant_user uuid;
BEGIN
 SELECT * INTO j FROM public.repair_jobs WHERE id=p_id;
 INSERT INTO public.repair_events(job_id,actor_id,action,snapshot) VALUES(j.id,auth.uid(),p_action,to_jsonb(j));
 IF auth.uid() IS DISTINCT FROM j.owner_id THEN
  INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id) VALUES(j.owner_id,'repair_status','Работа по объекту обновлена',left(j.title,1000),'/repairs','repair',j.id);
 END IF;
 IF j.published_at IS NOT NULL AND p_action IN ('approve','start','report','accept','return','cancel') THEN
  SELECT t.user_id INTO tenant_user FROM public.requests r JOIN public.tenants t ON t.id=r.tenant_id WHERE r.id=j.request_id AND r.owner_id=j.owner_id;
  IF tenant_user IS NOT NULL AND tenant_user IS DISTINCT FROM auth.uid() THEN
   INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id) VALUES(tenant_user,'repair_status','Ход ремонта обновлён',left(j.title,1000),'/repairs','repair',j.id);
  END IF;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.record_repair_event(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.save_repair_job(p_property_id uuid,p_id uuid,p_values jsonb,p_revision integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.repair_jobs; p public.properties; role_name text; item jsonb; items jsonb:='[]'; qty numeric; price numeric; total numeric:=0; contractor uuid; snap jsonb; req uuid; start_on date; due_on date;
BEGIN
 SELECT * INTO p FROM public.properties WHERE id=p_property_id;
 IF auth.uid() IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'Объект недоступен' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team:'||p.owner_id::text,0));
 PERFORM 1 FROM public.properties WHERE id=p.id AND owner_id=p.owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Собственник объекта изменён. Обновите страницу' USING ERRCODE='40001'; END IF;
 role_name:=private.repair_property_role(p.id);
 IF role_name IS NULL OR role_name NOT IN ('owner','manager') THEN RAISE EXCEPTION 'Нет права оформлять работы' USING ERRCODE='42501'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO j FROM public.repair_jobs WHERE id=p_id AND property_id=p.id AND owner_id=p.owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Работа недоступна' USING ERRCODE='42501'; END IF;
  IF j.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Работа уже изменена. Обновите страницу' USING ERRCODE='40001'; END IF;
  IF j.status<>'draft' THEN RAISE EXCEPTION 'Изменять можно только черновик сметы' USING ERRCODE='23514'; END IF;
 ELSE
  IF p_revision IS NOT NULL THEN RAISE EXCEPTION 'Работа уже изменена' USING ERRCODE='40001'; END IF;
 END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR coalesce(length(btrim(p_values->>'title')),0) NOT BETWEEN 1 AND 200 OR length(coalesce(p_values->>'description',''))>2000
  OR jsonb_typeof(p_values->'estimate_items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_values->'estimate_items') NOT BETWEEN 1 AND 30 THEN
  RAISE EXCEPTION 'Заполните название и от 1 до 30 строк сметы' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_values->'estimate_items') LOOP
  IF coalesce(length(btrim(item->>'name')),0) NOT BETWEEN 1 AND 120 OR coalesce(item->>'quantity','') !~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' OR coalesce(item->>'unit_price','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' THEN
   RAISE EXCEPTION 'Укажите описание, количество и цену с точностью до двух знаков' USING ERRCODE='22023'; END IF;
  qty:=(item->>'quantity')::numeric; price:=(item->>'unit_price')::numeric;
  IF qty<=0 OR qty>10000 OR price<=0 OR price>=1000000000 THEN RAISE EXCEPTION 'Проверьте количество и стоимость' USING ERRCODE='22023'; END IF;
  total:=total+round(qty*price,2);
  items:=items||jsonb_build_array(jsonb_build_object('name',btrim(item->>'name'),'quantity',qty,'unit_price',price,'amount',round(qty*price,2)));
 END LOOP;
 IF total<=0 OR total>=1000000000 THEN RAISE EXCEPTION 'Проверьте итог сметы' USING ERRCODE='22023'; END IF;
 start_on:=(p_values->>'scheduled_date')::date; due_on:=(p_values->>'due_date')::date;
 IF start_on IS NULL OR due_on IS NULL OR start_on<'2000-01-01' OR due_on>'2100-12-31' OR start_on>due_on THEN RAISE EXCEPTION 'Проверьте даты начала и окончания работы' USING ERRCODE='22023'; END IF;
 contractor:=nullif(p_values->>'contractor_id','')::uuid;
 IF role_name<>'owner' AND contractor IS DISTINCT FROM j.contractor_id THEN RAISE EXCEPTION 'Исполнителя назначает собственник' USING ERRCODE='42501'; END IF;
 IF contractor IS NOT NULL THEN
  SELECT jsonb_build_object('name',name,'specialty',specialty,'phone',phone,'email',email) INTO snap FROM public.repair_contractors
    WHERE id=contractor AND owner_id=p.owner_id AND (active OR id=j.contractor_id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Исполнитель недоступен у этого собственника' USING ERRCODE='42501'; END IF;
 END IF;
 req:=nullif(p_values->>'request_id','')::uuid;
 IF j.id IS NOT NULL AND req IS DISTINCT FROM j.request_id THEN RAISE EXCEPTION 'Связанную заявку нельзя заменить' USING ERRCODE='23514'; END IF;
 IF req IS NOT NULL THEN
  PERFORM 1 FROM public.requests WHERE id=req AND owner_id=p.owner_id AND property_id=p.id AND category='repair' AND (status<>'closed' OR id=j.request_id) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Выберите открытую ремонтную заявку этого объекта' USING ERRCODE='42501'; END IF;
 END IF;
 IF j.id IS NULL THEN
  INSERT INTO public.repair_jobs(property_id,owner_id,request_id,contractor_id,contractor_snapshot,title,description,scheduled_date,due_date,estimate_items,estimated_total)
   VALUES(p.id,p.owner_id,req,contractor,snap,btrim(p_values->>'title'),coalesce(p_values->>'description',''),start_on,due_on,items,total) RETURNING * INTO j;
 ELSE
  UPDATE public.repair_jobs SET contractor_id=contractor,contractor_snapshot=snap,title=btrim(p_values->>'title'),description=coalesce(p_values->>'description',''),scheduled_date=start_on,due_date=due_on,estimate_items=items,estimated_total=total,decision_note='',revision=revision+1,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
 END IF;
 PERFORM private.record_repair_event(j.id,'draft_saved'); RETURN j.id;
END;
$$;

CREATE FUNCTION private.act_on_repair_job(p_id uuid,p_action text,p_revision integer,p_values jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.repair_jobs; v_owner uuid; role_name text; note_text text:=btrim(coalesce(p_values->>'note','')); photos text[]; photo text; actual numeric; expense uuid;
BEGIN
 SELECT owner_id INTO v_owner FROM public.repair_jobs WHERE id=p_id;
 IF auth.uid() IS NULL OR v_owner IS NULL THEN RAISE EXCEPTION 'Работа недоступна' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team:'||v_owner::text,0));
 PERFORM 1 FROM public.properties p JOIN public.repair_jobs r ON r.property_id=p.id WHERE r.id=p_id AND p.owner_id=v_owner FOR UPDATE OF p;
 IF NOT FOUND OR NOT private.repair_job_access(p_id,true) THEN RAISE EXCEPTION 'Нет права изменять работу' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM public.repair_jobs WHERE id=p_id FOR UPDATE;
 role_name:=private.repair_property_role(j.property_id);
 IF p_action IN ('approve','reject','accept','return','cancel','expense') AND role_name<>'owner' THEN RAISE EXCEPTION 'Это действие выполняет собственник' USING ERRCODE='42501'; END IF;
 IF p_action='expense' AND j.expense_id IS NOT NULL THEN RETURN j.expense_id; END IF;
 IF p_action='accept' AND j.status='completed' THEN RETURN j.id; END IF;
 IF j.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Работа уже изменена. Обновите страницу' USING ERRCODE='40001'; END IF;
 IF length(note_text)>2000 OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Проверьте комментарий' USING ERRCODE='22023'; END IF;
 CASE p_action
 WHEN 'submit' THEN
  IF j.status<>'draft' OR j.contractor_id IS NULL THEN RAISE EXCEPTION 'Для отправки нужен черновик с назначенным исполнителем' USING ERRCODE='23514'; END IF;
  UPDATE public.repair_jobs SET status='pending',decision_note='' WHERE id=j.id;
 WHEN 'approve' THEN
  IF j.status<>'pending' THEN RAISE EXCEPTION 'Смета не ожидает согласования' USING ERRCODE='23514'; END IF;
  UPDATE public.repair_jobs SET status='approved',published_at=coalesce(published_at,now()),decision_note=note_text WHERE id=j.id;
 WHEN 'reject' THEN
  IF j.status<>'pending' OR note_text='' THEN RAISE EXCEPTION 'Укажите причину возврата сметы' USING ERRCODE='23514'; END IF;
  UPDATE public.repair_jobs SET status='draft',decision_note=note_text WHERE id=j.id;
 WHEN 'start' THEN
  IF j.status<>'approved' THEN RAISE EXCEPTION 'Сначала согласуйте смету' USING ERRCODE='23514'; END IF;
  UPDATE public.repair_jobs SET status='in_progress' WHERE id=j.id;
  UPDATE public.requests SET status='in_progress' WHERE id=j.request_id AND status<>'in_progress';
 WHEN 'report' THEN
  IF j.status<>'in_progress' THEN RAISE EXCEPTION 'Отчёт доступен для работы в процессе' USING ERRCODE='23514'; END IF;
  IF coalesce(p_values->>'actual_amount','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' OR note_text='' OR jsonb_typeof(p_values->'photos') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Укажите стоимость, описание и фото результата' USING ERRCODE='22023'; END IF;
  actual:=(p_values->>'actual_amount')::numeric;
  IF actual<=0 OR actual>=1000000000 OR jsonb_array_length(p_values->'photos') NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'Приложите от 1 до 8 фото и проверьте стоимость' USING ERRCODE='22023'; END IF;
  SELECT array_agg(DISTINCT value) INTO photos FROM jsonb_array_elements_text(p_values->'photos');
  FOREACH photo IN ARRAY photos LOOP
   IF photo IS NULL OR split_part(photo,'/',2)<>j.id::text OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='repair-result-photos' AND o.name=photo AND (
     (o.owner_id=auth.uid()::text AND split_part(photo,'/',1)=auth.uid()::text)
     OR photo=ANY(j.result_photos) OR EXISTS(SELECT 1 FROM public.repair_events e WHERE e.job_id=j.id AND e.snapshot->'result_photos' ? photo))) THEN
    RAISE EXCEPTION 'Фото должно быть загружено для этой работы' USING ERRCODE='42501'; END IF;
  END LOOP;
  UPDATE public.repair_jobs SET status='review',actual_amount=actual,result_note=note_text,result_photos=photos,decision_note='' WHERE id=j.id;
 WHEN 'return' THEN
  IF j.status<>'review' OR note_text='' THEN RAISE EXCEPTION 'Укажите причину доработки отчёта' USING ERRCODE='23514'; END IF;
  UPDATE public.repair_jobs SET status='in_progress',actual_amount=NULL,result_note='',result_photos='{}',decision_note=note_text WHERE id=j.id;
 WHEN 'accept' THEN
  IF j.status<>'review' THEN RAISE EXCEPTION 'Работа ещё не передана на приёмку' USING ERRCODE='23514'; END IF;
  IF j.actual_amount>j.estimated_total AND note_text='' THEN RAISE EXCEPTION 'Для превышения сметы укажите причину согласования' USING ERRCODE='23514'; END IF;
  UPDATE public.repair_jobs SET status='completed',completed_at=now(),decision_note=note_text WHERE id=j.id;
  UPDATE public.requests SET status='closed' WHERE id=j.request_id AND status<>'closed';
 WHEN 'cancel' THEN
  IF j.status IN ('completed','cancelled') OR note_text='' THEN RAISE EXCEPTION 'Укажите причину отмены незавершённой работы' USING ERRCODE='23514'; END IF;
  UPDATE public.repair_jobs SET status='cancelled',decision_note=note_text WHERE id=j.id;
 WHEN 'expense' THEN
  IF j.status<>'completed' THEN RAISE EXCEPTION 'Сначала примите результат работы' USING ERRCODE='23514'; END IF;
  expense:=private.save_property_expense(j.property_id,NULL,jsonb_build_object('title',left('Ремонт: '||j.title,200),'category','repair','planned_date',j.completed_at::date,
    'planned_amount',j.actual_amount,'status','planned','paid_date',NULL,'paid_amount',NULL,'receipt_file',NULL,
    'note',left('Работа №'||j.id::text||'. Смета: '||j.estimated_total::text||'. Принятая стоимость: '||j.actual_amount::text||'. '||j.result_note,2000)),NULL,NULL);
  UPDATE public.repair_jobs SET expense_id=expense WHERE id=j.id;
 ELSE RAISE EXCEPTION 'Неизвестное действие' USING ERRCODE='22023';
 END CASE;
 UPDATE public.repair_jobs SET revision=revision+1,updated_at=clock_timestamp() WHERE id=j.id;
 PERFORM private.record_repair_event(j.id,p_action);
 RETURN coalesce(expense,j.id);
END;
$$;

CREATE FUNCTION private.repairs_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 WITH props AS (
  SELECT p.id,p.owner_id,p.name,p.address,private.repair_property_role(p.id) AS role FROM public.properties p WHERE private.repair_property_role(p.id) IS NOT NULL
 ), jobs AS (
  SELECT j.*,p.name AS property_name,p.role, r.title AS request_title FROM public.repair_jobs j JOIN props p ON p.id=j.property_id LEFT JOIN public.requests r ON r.id=j.request_id
  WHERE private.repair_job_access(j.id,false) ORDER BY j.created_at DESC,j.id DESC LIMIT 500
 ), events AS (
  SELECT e.id,e.job_id,e.action,e.snapshot,e.created_at,coalesce(nullif(u.name,''),'Пользователь') AS actor_name
  FROM public.repair_events e JOIN jobs j ON j.id=e.job_id AND j.role<>'tenant' LEFT JOIN public.profiles u ON u.id=e.actor_id
  ORDER BY e.created_at DESC,e.id DESC LIMIT 2000
 )
 SELECT jsonb_build_object(
  'properties',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY name,id) FROM props p),'[]'),
  'contractors',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY name,id) FROM public.repair_contractors c WHERE c.owner_id=auth.uid() OR private.has_role(auth.uid(),'admin')),'[]'),
  'requests',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'property_id',r.property_id,'title',r.title,'description',r.description) ORDER BY r.created_at DESC,r.id)
    FROM public.requests r JOIN props p ON p.id=r.property_id AND p.owner_id=r.owner_id AND p.role IN ('owner','manager') WHERE r.category='repair' AND r.status<>'closed'
    AND NOT EXISTS(SELECT 1 FROM public.repair_jobs j WHERE j.request_id=r.id AND j.status<>'cancelled')),'[]'),
  'jobs',coalesce((SELECT jsonb_agg(CASE WHEN j.role='tenant' THEN to_jsonb(j)||jsonb_build_object('contractor_id',NULL,'contractor_snapshot',NULL,'estimate_items','[]'::jsonb,'estimated_total',NULL,'actual_amount',NULL,'expense_id',NULL,'decision_note','') ELSE to_jsonb(j) END ORDER BY j.created_at DESC,j.id DESC) FROM jobs j),'[]'),
  'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC,id DESC) FROM events e),'[]'),
  'jobs_truncated',(SELECT count(*)>500 FROM public.repair_jobs WHERE private.repair_job_access(id,false)),
  'events_truncated',(SELECT count(*)>2000 FROM public.repair_events e JOIN jobs j ON j.id=e.job_id AND j.role<>'tenant')
 ) INTO result;
 RETURN result;
END;
$$;

CREATE FUNCTION private.repair_photo_access(p_path text,p_write boolean DEFAULT false,p_delete boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE job_id uuid; j public.repair_jobs; attached boolean; tenant_only boolean;
BEGIN
 IF auth.uid() IS NULL OR array_length(string_to_array(p_path,'/'),1)<>3 THEN RETURN false; END IF;
 BEGIN job_id:=split_part(p_path,'/',2)::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
 SELECT * INTO j FROM public.repair_jobs WHERE id=job_id;
 IF NOT FOUND OR NOT private.repair_job_access(j.id,p_write OR p_delete) THEN RETURN false; END IF;
 attached:=p_path=ANY(j.result_photos) OR EXISTS(SELECT 1 FROM public.repair_events e WHERE e.job_id=j.id AND e.snapshot->'result_photos' ? p_path);
 IF p_write THEN RETURN j.status='in_progress' AND split_part(p_path,'/',1)=auth.uid()::text;
 ELSIF p_delete THEN RETURN NOT attached AND split_part(p_path,'/',1)=auth.uid()::text;
 END IF;
 tenant_only:=private.repair_property_role(j.property_id)='tenant';
 IF tenant_only THEN RETURN p_path=ANY(j.result_photos); END IF;
 RETURN attached OR (private.repair_job_access(j.id,true) AND split_part(p_path,'/',1)=auth.uid()::text);
END;
$$;
REVOKE ALL ON FUNCTION private.repair_photo_access(text,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.repair_photo_access(text,boolean,boolean) TO authenticated,service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('repair-result-photos','repair-result-photos',false,8388608,ARRAY['image/jpeg','image/png','image/webp']);
CREATE POLICY repair_photos_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='repair-result-photos' AND private.repair_photo_access(name,true,false));
CREATE POLICY repair_photos_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='repair-result-photos' AND private.repair_photo_access(name,false,false));
CREATE POLICY repair_photos_delete_unattached ON storage.objects FOR DELETE TO authenticated USING(bucket_id='repair-result-photos' AND private.repair_photo_access(name,false,true));

CREATE FUNCTION private.protect_repair_relations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='properties' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id AND EXISTS(SELECT 1 FROM public.repair_jobs WHERE property_id=OLD.id) THEN
  RAISE EXCEPTION 'Объект с историей ремонта нельзя передать другому собственнику' USING ERRCODE='23514';
 ELSIF TG_TABLE_NAME='requests' AND NEW.status='closed' AND EXISTS(SELECT 1 FROM public.repair_jobs WHERE request_id=OLD.id AND status NOT IN ('completed','cancelled')) THEN
  RAISE EXCEPTION 'Сначала примите или отмените связанную ремонтную работу' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_repair_relations() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_repair_property BEFORE UPDATE OF owner_id ON public.properties FOR EACH ROW EXECUTE FUNCTION private.protect_repair_relations();
CREATE TRIGGER protect_repair_request BEFORE UPDATE OF status ON public.requests FOR EACH ROW EXECUTE FUNCTION private.protect_repair_relations();
ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE public.notifications DROP CONSTRAINT notifications_entity_type_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_valid CHECK(entity_type IN ('request','agreement','rent_charge','repair'));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid CHECK(kind IN ('request_created','request_comment','request_status','agreement_created','agreement_status','agreement_accepted','agreement_expiring','payment_status','payment_due','payment_overdue','payment_reminder','payment_reported','payment_report_status','utility_submitted','utility_reviewed','handover_status','agreement_amendment','repair_status'));

CREATE FUNCTION public.repairs_overview() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.repairs_overview();$$;
CREATE FUNCTION public.save_repair_contractor(p_owner_id uuid,p_id uuid,p_values jsonb,p_revision integer) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.save_repair_contractor(p_owner_id,p_id,p_values,p_revision);$$;
CREATE FUNCTION public.save_repair_job(p_property_id uuid,p_id uuid,p_values jsonb,p_revision integer) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.save_repair_job(p_property_id,p_id,p_values,p_revision);$$;
CREATE FUNCTION public.act_on_repair_job(p_id uuid,p_action text,p_revision integer,p_values jsonb DEFAULT '{}') RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.act_on_repair_job(p_id,p_action,p_revision,p_values);$$;
REVOKE ALL ON FUNCTION public.repairs_overview(),public.save_repair_contractor(uuid,uuid,jsonb,integer),public.save_repair_job(uuid,uuid,jsonb,integer),public.act_on_repair_job(uuid,text,integer,jsonb),private.repairs_overview(),private.save_repair_contractor(uuid,uuid,jsonb,integer),private.save_repair_job(uuid,uuid,jsonb,integer),private.act_on_repair_job(uuid,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.repairs_overview(),public.save_repair_contractor(uuid,uuid,jsonb,integer),public.save_repair_job(uuid,uuid,jsonb,integer),public.act_on_repair_job(uuid,text,integer,jsonb),private.repairs_overview(),private.save_repair_contractor(uuid,uuid,jsonb,integer),private.save_repair_job(uuid,uuid,jsonb,integer),private.act_on_repair_job(uuid,text,integer,jsonb) TO authenticated,service_role;
