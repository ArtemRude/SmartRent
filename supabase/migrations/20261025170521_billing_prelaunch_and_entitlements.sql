-- Billing is deliberately dormant until an authenticated DB administrator launches it.
SET lock_timeout='5s';
SET statement_timeout='30s';
CREATE TABLE private.billing_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 mode text NOT NULL DEFAULT 'prelaunch' CHECK(mode IN ('prelaunch','enforced')),
 launched_at timestamptz,
 CHECK(mode='prelaunch' OR launched_at IS NOT NULL)
);
INSERT INTO private.billing_settings(singleton) VALUES(true);
CREATE TABLE private.billing_subscriptions (
 owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 plan text NOT NULL DEFAULT 'start' CHECK(plan IN ('start','owner','portfolio','team')),
 paid_until timestamptz CHECK(paid_until IS NULL OR isfinite(paid_until)),
 trial_until timestamptz,
 notice_until timestamptz,
 notice_launch_at timestamptz
);
CREATE TABLE private.billing_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN ('launch','pause','subscription')),
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_events_created_idx ON private.billing_events(created_at DESC,id);
ALTER TABLE private.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.billing_settings,private.billing_subscriptions,private.billing_events FROM PUBLIC,anon,authenticated,service_role;
-- Narrow RPCs own all writes, including service integrations. No client-writable plan or launch flag.
CREATE FUNCTION private.billing_units_used(p_owner uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(sum(greatest(1,
  (SELECT count(*) FROM public.units u WHERE u.property_id=p.id),
  (SELECT count(DISTINCT coalesce(a.unit_id,'00000000-0000-0000-0000-000000000000')) FROM public.lease_agreements a WHERE a.property_id=p.id AND a.status IN ('active','pending_signature')))),0)::integer
 FROM public.properties p WHERE p.owner_id=p_owner AND (p.status='active' OR EXISTS(
  SELECT 1 FROM public.lease_agreements a WHERE a.property_id=p.id AND a.status IN ('active','pending_signature')));
$$;
CREATE FUNCTION private.billing_seats_used(p_owner uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*)::integer FROM public.team_memberships WHERE owner_id=p_owner
 AND (status='active' OR (status='invited' AND expires_at>now()));
$$;
-- Call only under the owner's billing lock. Only the owner's personal overview
-- acknowledges the notice; admin/manager/background actions cannot consume it.
CREATE FUNCTION private.billing_state(p_owner uuid,p_ack_notice boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.billing_settings; b private.billing_subscriptions; created timestamptz; effective text; unlimited boolean;
BEGIN
 SELECT * INTO STRICT s FROM private.billing_settings WHERE singleton;
 INSERT INTO private.billing_subscriptions(owner_id) VALUES(p_owner) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT b FROM private.billing_subscriptions WHERE owner_id=p_owner;
 IF s.mode='enforced' AND b.notice_launch_at IS DISTINCT FROM s.launched_at THEN
  SELECT created_at INTO created FROM auth.users WHERE id=p_owner;
  IF created>=s.launched_at THEN
   UPDATE private.billing_subscriptions SET trial_until=created+interval '30 days',notice_until=NULL,notice_launch_at=s.launched_at WHERE owner_id=p_owner RETURNING * INTO b;
  ELSIF p_ack_notice THEN
   UPDATE private.billing_subscriptions SET notice_until=now()+interval '30 days',notice_launch_at=s.launched_at WHERE owner_id=p_owner RETURNING * INTO b;

  END IF;
 END IF;
 unlimited:=s.mode='prelaunch' OR b.notice_until>now() OR b.notice_launch_at IS DISTINCT FROM s.launched_at;
 effective:=CASE WHEN b.plan<>'start' AND b.paid_until+interval '7 days'>now() THEN b.plan
  WHEN b.trial_until>now() THEN 'portfolio' ELSE 'start' END;
 RETURN jsonb_build_object('mode',s.mode,'launched_at',s.launched_at,'notice_until',b.notice_until,'plan',b.plan,
  'paid_until',b.paid_until,'trial_until',b.trial_until,'units_used',private.billing_units_used(p_owner),'seats_used',private.billing_seats_used(p_owner),
  'effective_plan',effective,'unlimited',coalesce(unlimited,false));
END;
$$;
CREATE FUNCTION private.billing_overview() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT (private.has_role(uid,'owner') OR private.has_role(uid,'admin')) THEN RAISE EXCEPTION 'Тариф доступен собственнику' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||uid::text,0));
 result:=private.billing_state(uid,true);
 RETURN result-ARRAY['effective_plan','unlimited'];
END;
$$;
CREATE FUNCTION public.billing_overview() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.billing_overview();$$;

CREATE FUNCTION private.billing_admin_launch(p_confirm boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.billing_settings;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Только администратор запускает тарифы' USING ERRCODE='42501'; END IF;
 IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'Подтвердите запуск платных тарифов' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT s FROM private.billing_settings WHERE singleton FOR UPDATE;
 IF s.mode='prelaunch' THEN
  UPDATE private.billing_settings SET mode='enforced',launched_at=clock_timestamp() WHERE singleton RETURNING * INTO s;
  INSERT INTO private.billing_events(actor_id,action,detail) VALUES(auth.uid(),'launch',to_jsonb(s));
 END IF;
 RETURN to_jsonb(s)-'singleton';
END;
$$;
CREATE FUNCTION public.billing_admin_launch(p_confirm boolean) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.billing_admin_launch(p_confirm);$$;
CREATE FUNCTION private.billing_admin_pause() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s private.billing_settings;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Только администратор управляет тарифами' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT s FROM private.billing_settings WHERE singleton FOR UPDATE;
 IF s.mode<>'prelaunch' THEN
  UPDATE private.billing_settings SET mode='prelaunch' WHERE singleton RETURNING * INTO s;
  INSERT INTO private.billing_events(actor_id,action,detail) VALUES(auth.uid(),'pause',to_jsonb(s));
 END IF;
 RETURN to_jsonb(s)-'singleton';
END;
$$;
CREATE FUNCTION public.billing_admin_pause() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.billing_admin_pause();$$;
CREATE FUNCTION private.billing_admin_set_subscription(p_owner_id uuid,p_plan text,p_paid_until timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Только администратор назначает подписку' USING ERRCODE='42501'; END IF;
 IF p_owner_id IS NULL OR NOT (private.has_role(p_owner_id,'owner') OR private.has_role(p_owner_id,'admin')) OR p_plan IS NULL OR p_plan NOT IN ('start','owner','portfolio','team')
  OR (p_plan='start' AND p_paid_until IS NOT NULL) OR (p_plan<>'start' AND (p_paid_until IS NULL OR NOT isfinite(p_paid_until) OR p_paid_until<=now())) THEN
  RAISE EXCEPTION 'Проверьте собственника, тариф и дату окончания оплаты' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||p_owner_id::text,0));
 INSERT INTO private.billing_subscriptions(owner_id,plan,paid_until) VALUES(p_owner_id,p_plan,p_paid_until)
 ON CONFLICT(owner_id) DO UPDATE SET plan=EXCLUDED.plan,paid_until=EXCLUDED.paid_until;
 INSERT INTO private.billing_events(actor_id,owner_id,action,detail) VALUES(auth.uid(),p_owner_id,'subscription',jsonb_build_object('plan',p_plan,'paid_until',p_paid_until));
END;
$$;
CREATE FUNCTION public.billing_admin_set_subscription(p_owner_id uuid,p_plan text,p_paid_until timestamptz) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.billing_admin_set_subscription(p_owner_id,p_plan,p_paid_until);$$;

-- Triggers derive the billed account from the row/property, never from auth.uid().
-- This also covers managers and SECURITY DEFINER operational RPCs used by admins.
CREATE FUNCTION private.billing_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid; b jsonb; plan text; cap integer; usage integer; delta integer:=0; require_rank integer:=0; rank integer;
BEGIN
 IF (SELECT mode FROM private.billing_settings WHERE singleton)='prelaunch' THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_TABLE_NAME='units' AND TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public.lease_agreements WHERE unit_id=OLD.id AND status IN ('active','pending_signature')) THEN
   RAISE EXCEPTION 'Завершите договор перед удалением занятого помещения' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_TABLE_NAME='properties' THEN
  owner:=NEW.owner_id;
  IF TG_OP='INSERT' THEN delta:=CASE WHEN NEW.status='active' THEN 1 ELSE 0 END;
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
   delta:=greatest(1,(SELECT count(*) FROM public.units WHERE property_id=NEW.id))::integer;
  ELSIF NEW.status='active' AND OLD.status<>'active' AND NOT EXISTS(SELECT 1 FROM public.lease_agreements WHERE property_id=NEW.id AND status IN ('active','pending_signature')) THEN
   delta:=greatest(1,(SELECT count(*) FROM public.units WHERE property_id=NEW.id))::integer;
  ELSE RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='units' THEN
  IF TG_OP='UPDATE' AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN RETURN NEW; END IF;
  SELECT owner_id INTO owner FROM public.properties WHERE id=NEW.property_id;
  -- Recompute under the owner lock below; the first explicit unit replaces an implicit unit.
 ELSIF TG_TABLE_NAME='lease_agreements' THEN
  owner:=NEW.owner_id;
  IF TG_OP='UPDATE' THEN
   IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN NULL;
   ELSIF OLD.status NOT IN ('active','pending_signature') AND NEW.status IN ('pending_signature','active') THEN NULL;
   ELSIF NEW.end_date>OLD.end_date THEN
    -- Already submitted addenda may finish even after a subscription expires.
    IF EXISTS(SELECT 1 FROM public.lease_amendments m WHERE m.agreement_id=NEW.id AND m.status='accepted' AND m.end_date=NEW.end_date) THEN RETURN NEW; END IF;
   ELSE RETURN NEW; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='lease_amendments' THEN
  SELECT owner_id INTO owner FROM public.lease_agreements WHERE id=NEW.agreement_id;
  -- Only creating/extending a draft or publishing a fresh extension is gated.
  IF TG_OP='INSERT' THEN
   IF NEW.end_date<=NEW.previous_end_date THEN RETURN NEW; END IF;
  ELSIF NEW.end_date<=NEW.previous_end_date OR NOT (NEW.end_date>OLD.end_date OR (OLD.status='draft' AND NEW.status='pending')) THEN RETURN NEW;
  END IF;
 ELSIF TG_TABLE_NAME='team_memberships' THEN
  owner:=NEW.owner_id; require_rank:=3;
  IF TG_OP='UPDATE' AND OLD.status='invited' AND NEW.status='active' AND NEW.owner_id=OLD.owner_id THEN
   require_rank:=0;
  ELSIF TG_OP='UPDATE' AND NOT (NEW.owner_id IS DISTINCT FROM OLD.owner_id OR (NEW.status='invited' AND NEW.expires_at>now() AND (OLD.status='revoked' OR OLD.expires_at<=now()))) THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='property_expenses' THEN
  SELECT owner_id INTO owner FROM public.properties WHERE id=NEW.property_id; require_rank:=1;
  -- One expense for a previously accepted repair remains a permitted completion.
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.repair_jobs j WHERE j.property_id=NEW.property_id AND j.status='completed' AND j.expense_id IS NULL
   AND NEW.title=left('Ремонт: '||j.title,200) AND NEW.category='repair' AND NEW.status='planned' AND NEW.planned_amount=j.actual_amount
   AND NEW.note=left('Работа №'||j.id::text||'. Смета: '||j.estimated_total::text||'. Принятая стоимость: '||j.actual_amount::text||'. '||j.result_note,2000)
   AND NOT EXISTS(SELECT 1 FROM public.property_expenses e WHERE e.property_id=j.property_id AND e.note=NEW.note)) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='repair_jobs' THEN
  SELECT owner_id INTO owner FROM public.properties WHERE id=NEW.property_id; require_rank:=2;
  IF TG_OP='UPDATE' AND (NEW.owner_id,NEW.property_id) IS NOT DISTINCT FROM (OLD.owner_id,OLD.property_id) THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='property_listings' THEN
  SELECT owner_id INTO owner FROM public.properties WHERE id=NEW.property_id; require_rank:=2;
  IF TG_OP='UPDATE' AND NEW.property_id IS NOT DISTINCT FROM OLD.property_id AND NOT (NEW.status='published' AND OLD.status<>'published') THEN RETURN NEW; END IF;
 END IF;
 IF owner IS NULL THEN RETURN NEW; END IF; -- Existing FK/integrity checks reject invalid references.
 PERFORM pg_advisory_xact_lock(hashtextextended('billing:'||owner::text,0));
 b:=private.billing_state(owner);
 IF (b->>'unlimited')::boolean THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='lease_agreements' THEN
 IF (TG_OP='INSERT' OR NEW.property_id IS DISTINCT FROM OLD.property_id OR (OLD.status NOT IN ('active','pending_signature') AND NEW.status IN ('pending_signature','active')))
  AND EXISTS(SELECT 1 FROM public.properties WHERE id=NEW.property_id AND status<>'active') THEN
  RAISE EXCEPTION 'Восстановите объект из архива перед новым договором' USING ERRCODE='23514'; END IF;
 END IF;
 plan:=b->>'effective_plan'; rank:=CASE plan WHEN 'team' THEN 3 WHEN 'portfolio' THEN 2 WHEN 'owner' THEN 1 ELSE 0 END;
 cap:=CASE plan WHEN 'team' THEN 50 WHEN 'portfolio' THEN 20 WHEN 'owner' THEN 5 ELSE 1 END;
 IF rank<require_rank THEN RAISE EXCEPTION 'BILLING_PLAN_REQUIRED: Для нового действия нужен подходящий тариф. Откройте «Тариф и доступ»' USING ERRCODE='P0001'; END IF;
 usage:=(b->>'units_used')::integer;
 IF TG_TABLE_NAME='lease_agreements' THEN
  IF NEW.status IN ('active','pending_signature') THEN
   -- Project the target space before insertion/activation. A whole-property lease
   -- and a separately leased unit must not silently create an extra billable space.
   SELECT greatest(1,(SELECT count(*) FROM public.units WHERE property_id=NEW.property_id),
    (SELECT count(DISTINCT token) FROM (
     SELECT coalesce(a.unit_id,'00000000-0000-0000-0000-000000000000') AS token FROM public.lease_agreements a
      WHERE a.property_id=NEW.property_id AND a.status IN ('active','pending_signature') AND a.id<>NEW.id
     UNION ALL SELECT coalesce(NEW.unit_id,'00000000-0000-0000-0000-000000000000')) projected))
    -greatest(1,(SELECT count(*) FROM public.units WHERE property_id=NEW.property_id),
     (SELECT count(DISTINCT coalesce(a.unit_id,'00000000-0000-0000-0000-000000000000')) FROM public.lease_agreements a
      WHERE a.property_id=NEW.property_id AND a.status IN ('active','pending_signature')))
   INTO delta;
  END IF;
 END IF;

 IF TG_TABLE_NAME='units' THEN
  IF EXISTS(SELECT 1 FROM public.properties p WHERE p.id=NEW.property_id AND (p.status='active' OR EXISTS(SELECT 1 FROM public.lease_agreements a WHERE a.property_id=p.id AND a.status IN ('active','pending_signature')))) THEN
   delta:=CASE WHEN (SELECT count(*) FROM public.units WHERE property_id=NEW.property_id)>=greatest(1,(SELECT count(DISTINCT coalesce(unit_id,'00000000-0000-0000-0000-000000000000')) FROM public.lease_agreements WHERE property_id=NEW.property_id AND status IN ('active','pending_signature'))) THEN 1 ELSE 0 END;
  END IF;
 END IF;
 IF TG_TABLE_NAME IN ('properties','units','lease_agreements','lease_amendments') AND usage+delta>cap THEN
  RAISE EXCEPTION 'BILLING_UNIT_LIMIT: Лимит единиц аренды исчерпан. Откройте «Тариф и доступ»' USING ERRCODE='P0001'; END IF;
 IF TG_TABLE_NAME='team_memberships' AND ((require_rank=3 AND (b->>'seats_used')::integer>=5) OR (require_rank=0 AND (b->>'seats_used')::integer>5)) THEN
  RAISE EXCEPTION 'BILLING_SEAT_LIMIT: Доступно до 5 сотрудников. Отзовите лишнее приглашение' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER billing_guard_properties BEFORE INSERT OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION private.billing_guard();
CREATE TRIGGER billing_guard_units BEFORE INSERT OR UPDATE OR DELETE ON public.units FOR EACH ROW EXECUTE FUNCTION private.billing_guard();
CREATE TRIGGER billing_guard_agreements BEFORE INSERT OR UPDATE ON public.lease_agreements FOR EACH ROW EXECUTE FUNCTION private.billing_guard();
CREATE TRIGGER billing_guard_amendments BEFORE INSERT OR UPDATE ON public.lease_amendments FOR EACH ROW EXECUTE FUNCTION private.billing_guard();
CREATE TRIGGER billing_guard_expenses BEFORE INSERT OR UPDATE ON public.property_expenses FOR EACH ROW EXECUTE FUNCTION private.billing_guard();
CREATE TRIGGER billing_guard_repairs BEFORE INSERT OR UPDATE ON public.repair_jobs FOR EACH ROW EXECUTE FUNCTION private.billing_guard();
CREATE TRIGGER billing_guard_listings BEFORE INSERT OR UPDATE ON public.property_listings FOR EACH ROW EXECUTE FUNCTION private.billing_guard();
CREATE TRIGGER billing_guard_team BEFORE INSERT OR UPDATE ON public.team_memberships FOR EACH ROW EXECUTE FUNCTION private.billing_guard();
REVOKE ALL ON FUNCTION private.billing_units_used(uuid),private.billing_seats_used(uuid),private.billing_state(uuid,boolean),private.billing_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.billing_overview(),public.billing_overview(),private.billing_admin_launch(boolean),public.billing_admin_launch(boolean),private.billing_admin_pause(),public.billing_admin_pause(),private.billing_admin_set_subscription(uuid,text,timestamptz),public.billing_admin_set_subscription(uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.billing_overview(),public.billing_overview(),private.billing_admin_launch(boolean),public.billing_admin_launch(boolean),private.billing_admin_pause(),public.billing_admin_pause(),private.billing_admin_set_subscription(uuid,text,timestamptz),public.billing_admin_set_subscription(uuid,text,timestamptz) TO authenticated;
