SET lock_timeout='5s';
SET statement_timeout='30s';
CREATE INDEX property_listings_catalog_idx ON public.property_listings(published_at DESC,public_id) WHERE status='published';
CREATE INDEX properties_catalog_idx ON public.properties(owner_id,type,status,created_at DESC,id);
CREATE INDEX properties_catalog_photos_idx ON public.properties USING gin(photos);
-- A reusable read model; never callable by a browser. Public rows contain only marketing fields.
CREATE FUNCTION private.catalog_rows(p_public boolean) RETURNS TABLE(
 id uuid, data jsonb, title text, location text, description text, category text, state text, occupancy text,
 price numeric, area numeric, created_at timestamptz, is_published boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_public THEN
  RETURN QUERY SELECT l.public_id,jsonb_build_object(
   'id',l.public_id,'scope','public','title',l.published_snapshot->>'title','location',l.published_snapshot->>'location',
   'description',l.published_snapshot->>'description','type',p.type,'status','published','occupancy','offer','price',(l.published_snapshot->>'monthly_rent')::numeric,
   'price_source','offer','area',nullif((l.published_snapshot->>'area')::numeric,0),'photos',l.published_snapshot->'photos','photo_bucket','listing-photos',
   'available_from',l.published_snapshot->>'available_from','published',true,'created_at',l.published_at),
   l.published_snapshot->>'title',l.published_snapshot->>'location',l.published_snapshot->>'description',p.type::text,'published'::text,'offer'::text,
   (l.published_snapshot->>'monthly_rent')::numeric,nullif((l.published_snapshot->>'area')::numeric,0),l.published_at,true
   FROM public.property_listings l JOIN public.properties p ON p.id=l.property_id
   WHERE l.status='published' AND private.listing_is_available(l.id);
 ELSE
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id,jsonb_build_object(
   'id',p.id,'scope','internal','title',p.name,'location',p.address,'description',p.description,'type',p.type,'status',p.status,
   'occupancy',CASE WHEN a.live_count>0 THEN 'leased' WHEN a.future_count>0 THEN 'reserved' ELSE 'free' END,
   'price',coalesce(o.price,a.rent),'price_source',CASE WHEN o.price IS NOT NULL THEN 'offer' WHEN a.rent IS NOT NULL THEN 'contract' END,
   'area',coalesce(u.area,o.area),'photos',to_jsonb(p.photos),'photo_bucket','property-photos','unit_count',u.count,
   'open_requests',(SELECT count(*) FROM public.requests r WHERE r.property_id=p.id AND r.status<>'closed'),
   'published',o.count>0,'role',private.hub_role(p.id),'created_at',p.created_at),
   p.name,p.address,p.description,p.type::text,p.status,
   CASE WHEN a.live_count>0 THEN 'leased' WHEN a.future_count>0 THEN 'reserved' ELSE 'free' END,
   coalesce(o.price,a.rent),coalesce(u.area,o.area),p.created_at,o.count>0
   FROM public.properties p
   CROSS JOIN LATERAL(SELECT count(*) AS count,CASE WHEN count(*)>0 AND count(*)=count(x.area) THEN sum(x.area) END AS area FROM public.units x WHERE x.property_id=p.id) u
   CROSS JOIN LATERAL(SELECT count(*) FILTER(WHERE x.status='active' AND CURRENT_DATE BETWEEN x.start_date AND x.end_date) AS live_count,
    count(*) FILTER(WHERE x.status='pending_signature' OR (x.status='active' AND x.start_date>CURRENT_DATE)) AS future_count,
    sum(private.agreement_rent_at(x.id,date_trunc('month',CURRENT_DATE)::date,x.monthly_payment)) FILTER(WHERE x.status='active' AND CURRENT_DATE BETWEEN x.start_date AND x.end_date) AS rent
    FROM public.lease_agreements x WHERE x.property_id=p.id AND x.status IN ('active','pending_signature')) a
   CROSS JOIN LATERAL(SELECT count(*) AS count,min((x.published_snapshot->>'monthly_rent')::numeric) AS price,
    max(nullif((x.published_snapshot->>'area')::numeric,0)) FILTER(WHERE x.unit_id IS NULL) AS area
    FROM public.property_listings x WHERE x.property_id=p.id AND x.status='published' AND private.listing_is_available(x.id)) o
   WHERE private.hub_role(p.id) IS NOT NULL;
 END IF;
END;
$$;
CREATE FUNCTION private.property_catalog(p_public boolean,p_filters jsonb DEFAULT '{}',p_cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE query text:=btrim(coalesce(p_filters->>'q','')); cat text:=coalesce(p_filters->>'type','all'); st text:=coalesce(p_filters->>'status','all'); occ text:=coalesce(p_filters->>'occupancy','all'); pub text:=coalesce(p_filters->>'publication','all');
 ordering text:=coalesce(p_filters->>'sort','newest'); price_min numeric; price_max numeric; area_min numeric; area_max numeric;
 cursor_rank integer:=0; cursor_num numeric:=0; cursor_text text:=''; cursor_id uuid; result jsonb;
BEGIN
 IF NOT p_public AND auth.uid() IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_filters) IS DISTINCT FROM 'object' OR length(query)>200 OR (cat<>'all' AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_enum WHERE enumtypid='public.property_type'::regtype AND enumlabel=cat)) OR st NOT IN ('all','active','archived') OR occ NOT IN ('all','leased','reserved','free') OR pub NOT IN ('all','published','unpublished') OR ordering NOT IN ('newest','name','price_asc','price_desc','area_desc')
 OR (p_public AND (st<>'all' OR occ<>'all' OR pub<>'all')) THEN RAISE EXCEPTION 'Проверьте параметры поиска' USING ERRCODE='22023'; END IF;
 BEGIN
  price_min:=nullif(p_filters->>'price_min','')::numeric; price_max:=nullif(p_filters->>'price_max','')::numeric;
  area_min:=nullif(p_filters->>'area_min','')::numeric; area_max:=nullif(p_filters->>'area_max','')::numeric;
  IF p_cursor IS NOT NULL THEN
   IF jsonb_typeof(p_cursor) IS DISTINCT FROM 'object' OR p_cursor->>'sort' IS DISTINCT FROM ordering OR NOT p_cursor ?& ARRAY['rank','number','text','id'] OR length(p_cursor->>'text')>1000 OR length(p_cursor->>'number')>50 THEN RAISE EXCEPTION 'Некорректный курсор'; END IF;
   cursor_rank:=(p_cursor->>'rank')::integer; cursor_num:=(p_cursor->>'number')::numeric; cursor_text:=p_cursor->>'text'; cursor_id:=(p_cursor->>'id')::uuid;
   IF cursor_rank NOT IN (0,1) OR cursor_num IS NULL OR cursor_text IS NULL OR cursor_id IS NULL OR cursor_rank IS NULL OR cursor_num::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Некорректный курсор'; END IF;
  END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Проверьте числовые фильтры или обновите каталог' USING ERRCODE='22023'; END;
 IF coalesce(price_min,0)<0 OR coalesce(price_max,0)<0 OR coalesce(area_min,0)<0 OR coalesce(area_max,0)<0 OR coalesce(price_min,0)>999999999 OR coalesce(price_max,0)>999999999 OR coalesce(area_min,0)>999999999 OR coalesce(area_max,0)>999999999 OR price_min>price_max OR area_min>area_max
 OR coalesce(price_min,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(price_max,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(area_min,0)::text IN ('NaN','Infinity','-Infinity') OR coalesce(area_max,0)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Проверьте границы цены и площади' USING ERRCODE='22023'; END IF;
 WITH source AS MATERIALIZED(SELECT * FROM private.catalog_rows(p_public)), filtered AS MATERIALIZED(
  SELECT x.*,CASE WHEN ordering IN ('price_asc','price_desc') AND x.price IS NULL OR ordering='area_desc' AND x.area IS NULL THEN 1 ELSE 0 END AS rank,
   CASE ordering WHEN 'newest' THEN -extract(epoch FROM x.created_at) WHEN 'price_asc' THEN coalesce(x.price,0) WHEN 'price_desc' THEN -coalesce(x.price,0) WHEN 'area_desc' THEN -coalesce(x.area,0) ELSE 0 END AS number,
   CASE WHEN ordering='name' THEN lower(x.title) ELSE '' END AS text
  FROM source x WHERE (query='' OR position(lower(query) in lower(x.title||' '||x.location||' '||coalesce(x.description,'')))>0)
  AND (cat='all' OR x.category=cat) AND (st='all' OR x.state=st) AND (occ='all' OR x.occupancy=occ)
  AND (pub='all' OR x.is_published=(pub='published'))
  AND (price_min IS NULL OR x.price>=price_min) AND (price_max IS NULL OR x.price<=price_max)
  AND (area_min IS NULL OR x.area>=area_min) AND (area_max IS NULL OR x.area<=area_max)
 ), batch AS MATERIALIZED(
  SELECT * FROM filtered x WHERE p_cursor IS NULL OR (x.rank,x.number,x.text,x.id)>(cursor_rank,cursor_num,cursor_text,cursor_id)
  ORDER BY x.rank,x.number,x.text,x.id LIMIT 25
 ), page AS MATERIALIZED(SELECT * FROM batch ORDER BY rank,number,text,id LIMIT 24)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(data ORDER BY rank,number,text,id) FROM page),'[]'),
  'total',(SELECT count(*) FROM filtered),'all_total',(SELECT count(*) FROM source),
  'next_cursor',CASE WHEN (SELECT count(*) FROM batch)>24 THEN (SELECT jsonb_build_object('sort',ordering,'rank',rank,'number',number::text,'text',text,'id',id) FROM page ORDER BY rank DESC,number DESC,text DESC,id DESC LIMIT 1) END)
 INTO result;
 RETURN result;
END;
$$;
CREATE FUNCTION private.set_catalog_property_status(p_id uuid,p_expected text,p_status text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.properties;
BEGIN
 SELECT * INTO p FROM public.properties WHERE id=p_id;
 IF private.hub_role(p.id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Состояние объекта изменяет собственник' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('active','archived') THEN RAISE EXCEPTION 'Неизвестное состояние объекта' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team:'||p.owner_id::text,0));
 SELECT * INTO p FROM public.properties WHERE id=p_id FOR UPDATE;
 IF private.hub_role(p.id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Доступ изменён' USING ERRCODE='42501'; END IF;
 IF p.status=p_status THEN RETURN p.id; END IF;
 IF p.status IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Состояние объекта уже изменено. Обновите каталог' USING ERRCODE='40001'; END IF;
 UPDATE public.properties SET status=p_status WHERE id=p.id;
 -- Re-activation must not silently republish an archived offer. Keep history and require explicit publishing again.
 IF p_status='archived' THEN UPDATE public.property_listings SET status='paused',revision=revision+1,updated_at=now() WHERE property_id=p.id AND status='published'; END IF;
 INSERT INTO public.team_activity(owner_id,actor_id,property_id,action,detail) VALUES(p.owner_id,auth.uid(),p.id,'property_note',jsonb_build_object('text',CASE p_status WHEN 'archived' THEN 'Объект перемещён в архив' ELSE 'Объект возвращён в работу' END,'from_status',p.status,'to_status',p_status));
 RETURN p.id;
END;
$$;
CREATE FUNCTION private.catalog_photo_access(p_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.properties p WHERE p.photos @> ARRAY[p_path] AND split_part(p_path,'/',1)=p.owner_id::text AND private.hub_role(p.id) IS NOT NULL);
$$;
CREATE POLICY property_photos_read_team_catalog ON storage.objects FOR SELECT TO authenticated USING(bucket_id='property-photos' AND private.catalog_photo_access(name));
CREATE FUNCTION public.property_catalog(p_filters jsonb DEFAULT '{}',p_cursor jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.property_catalog(false,p_filters,p_cursor);$$;
CREATE FUNCTION public.set_catalog_property_status(p_id uuid,p_expected text,p_status text) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.set_catalog_property_status(p_id,p_expected,p_status);$$;
-- The common implementation is private and receives no caller-controlled public/private selector through the API.
REVOKE ALL ON FUNCTION private.catalog_rows(boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.property_catalog(boolean,jsonb,jsonb) FROM PUBLIC,anon;
-- Anonymous users need a fixed-public definer adapter: do not grant them the boolean-mode implementation.
CREATE FUNCTION private.public_property_catalog(p_filters jsonb,p_cursor jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT private.property_catalog(true,p_filters,p_cursor);$$;
CREATE FUNCTION public.public_property_catalog(p_filters jsonb DEFAULT '{}',p_cursor jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT private.public_property_catalog(p_filters,p_cursor);$$;
REVOKE ALL ON FUNCTION private.public_property_catalog(jsonb,jsonb),public.public_property_catalog(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.public_property_catalog(jsonb,jsonb),public.public_property_catalog(jsonb,jsonb) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.property_catalog(jsonb,jsonb),private.set_catalog_property_status(uuid,text,text),public.set_catalog_property_status(uuid,text,text),private.catalog_photo_access(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.property_catalog(boolean,jsonb,jsonb),public.property_catalog(jsonb,jsonb),private.set_catalog_property_status(uuid,text,text),public.set_catalog_property_status(uuid,text,text),private.catalog_photo_access(text) TO authenticated,service_role;
