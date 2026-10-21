SET lock_timeout='5s';
SET statement_timeout='30s';
CREATE TABLE public.lease_amendments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agreement_id uuid NOT NULL REFERENCES public.lease_agreements(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','accepted','rejected','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 effective_from date NOT NULL CHECK(extract(day FROM effective_from)=1),
 monthly_payment numeric(14,2) NOT NULL CHECK(monthly_payment>0 AND monthly_payment<1000000000),
 end_date date NOT NULL,
 previous_monthly_payment numeric(14,2) NOT NULL,
 previous_end_date date NOT NULL,
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=2000),
 review_note text CHECK(char_length(review_note)<=2000),
 agreement_snapshot jsonb NOT NULL,
 submitted_at timestamptz,
 decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_date>=effective_from),
 CHECK(status<>'rejected' OR NULLIF(btrim(review_note),'') IS NOT NULL)
);
CREATE UNIQUE INDEX lease_amendments_one_open_idx ON public.lease_amendments(agreement_id) WHERE status IN ('draft','pending');
CREATE UNIQUE INDEX lease_amendments_effective_idx ON public.lease_amendments(agreement_id,effective_from) WHERE status='accepted';
CREATE TABLE public.lease_amendment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),amendment_id uuid NOT NULL REFERENCES public.lease_amendments(id) ON DELETE RESTRICT,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,event_type text NOT NULL CHECK(event_type IN ('draft_saved','submitted','accepted','rejected','cancelled')),
 snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lease_amendment_events_record_idx ON public.lease_amendment_events(amendment_id,created_at,id);
CREATE INDEX lease_amendment_events_actor_idx ON public.lease_amendment_events(actor_id);
ALTER TABLE public.lease_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_amendment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lease_amendments,public.lease_amendment_events FROM anon,authenticated;
GRANT SELECT ON public.lease_amendments,public.lease_amendment_events TO authenticated;
GRANT ALL ON public.lease_amendments,public.lease_amendment_events TO service_role;
CREATE FUNCTION private.amendment_access(p_agreement_id uuid,p_manager_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.lease_agreements a WHERE a.id=p_agreement_id AND (
 a.owner_id=auth.uid() OR private.has_role(auth.uid(),'admin'::public.app_role)
 OR (NOT p_manager_only AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=a.tenant_id AND t.user_id=auth.uid()))));
$$;
REVOKE ALL ON FUNCTION private.amendment_access(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.amendment_access(uuid,boolean) TO authenticated,service_role;
CREATE POLICY amendments_read ON public.lease_amendments FOR SELECT TO authenticated USING(
 private.amendment_access(agreement_id,true) OR (status<>'draft' AND submitted_at IS NOT NULL AND private.amendment_access(agreement_id)));
CREATE POLICY amendment_events_read ON public.lease_amendment_events FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.lease_amendments m WHERE m.id=amendment_id AND (event_type<>'draft_saved' OR private.amendment_access(m.agreement_id,true))));
CREATE FUNCTION private.agreement_rent_at(p_agreement_id uuid,p_period date,p_base numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT monthly_payment FROM public.lease_amendments WHERE agreement_id=p_agreement_id AND status='accepted' AND effective_from<=p_period ORDER BY effective_from DESC LIMIT 1),p_base);
$$;
REVOKE ALL ON FUNCTION private.agreement_rent_at(uuid,date,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.save_lease_amendment(p_agreement_id uuid,p_id uuid,p_values jsonb,p_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.lease_agreements%ROWTYPE; m public.lease_amendments%ROWTYPE; effective date; target_end date; rate numeric; snapshot jsonb; old_rate numeric;
BEGIN
 IF NOT private.amendment_access(p_agreement_id,true) THEN RAISE EXCEPTION 'Нет доступа к изменению договора' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.lease_agreements WHERE id=p_agreement_id FOR UPDATE;
 IF NOT private.amendment_access(p_agreement_id,true) THEN RAISE EXCEPTION 'Нет доступа к изменению договора' USING ERRCODE='42501'; END IF;
 IF a.status<>'active' THEN RAISE EXCEPTION 'Изменить условия можно только у действующего договора' USING ERRCODE='23514'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO m FROM public.lease_amendments WHERE id=p_id AND agreement_id=a.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Предложение не найдено' USING ERRCODE='42501'; END IF;
  IF m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Предложение изменилось. Обновите данные' USING ERRCODE='40001'; END IF;
  IF m.status<>'draft' THEN RAISE EXCEPTION 'Изменить можно только черновик предложения' USING ERRCODE='23514'; END IF;
 ELSIF p_revision IS NOT NULL THEN RAISE EXCEPTION 'Предложение изменилось. Обновите данные' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lease_amendments WHERE agreement_id=a.id AND status IN ('draft','pending') AND id IS DISTINCT FROM p_id) THEN
  RAISE EXCEPTION 'Сначала завершите или отмените текущее предложение' USING ERRCODE='23514';
 END IF;
 effective:=(p_values->>'effective_from')::date; target_end:=(p_values->>'end_date')::date;
 IF effective IS NULL OR effective< (date_trunc('month',CURRENT_DATE)+interval '1 month')::date OR extract(day FROM effective)<>1
  OR effective<a.start_date OR target_end IS NULL OR target_end<a.end_date OR target_end<effective
  OR target_end>GREATEST(a.end_date,(CURRENT_DATE+interval '5 years')::date) THEN
  RAISE EXCEPTION 'Выберите первое число будущего месяца и срок не короче текущего, в пределах пяти лет' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lease_amendments WHERE agreement_id=a.id AND status='accepted' AND effective_from>=effective) THEN
  RAISE EXCEPTION 'Дата должна быть позже последнего согласованного изменения' USING ERRCODE='23514';
 END IF;
 IF COALESCE(p_values->>'monthly_payment','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'Укажите ставку с точностью до копеек' USING ERRCODE='23514'; END IF;
 rate:=(p_values->>'monthly_payment')::numeric;
 IF rate<=0 OR char_length(COALESCE(p_values->>'note',''))>2000 THEN RAISE EXCEPTION 'Проверьте ставку и описание изменения' USING ERRCODE='23514'; END IF;
 old_rate:=private.agreement_rent_at(a.id,effective,a.monthly_payment);
 IF rate=old_rate AND target_end=a.end_date THEN RAISE EXCEPTION 'Укажите новую ставку или продление срока' USING ERRCODE='23514'; END IF;
 SELECT to_jsonb(a)||jsonb_build_object('property_name',p.name,'property_address',p.address,'tenant_name',t.name,'tenant_email',t.email,
  'owner_name',COALESCE(pr.name,'Собственник'),'owner_email',COALESCE(pr.email,'')) INTO snapshot
 FROM public.properties p JOIN public.tenants t ON t.id=a.tenant_id LEFT JOIN public.profiles pr ON pr.id=a.owner_id WHERE p.id=a.property_id;
 IF m.id IS NULL THEN
  INSERT INTO public.lease_amendments(agreement_id,effective_from,monthly_payment,end_date,previous_monthly_payment,previous_end_date,note,agreement_snapshot)
  VALUES(a.id,effective,rate,target_end,old_rate,a.end_date,COALESCE(p_values->>'note',''),snapshot) RETURNING * INTO m;
 ELSE
  UPDATE public.lease_amendments SET effective_from=effective,monthly_payment=rate,end_date=target_end,previous_monthly_payment=old_rate,previous_end_date=a.end_date,
   note=COALESCE(p_values->>'note',''),agreement_snapshot=snapshot,revision=revision+1,updated_at=clock_timestamp() WHERE id=m.id RETURNING * INTO m;
 END IF;
 INSERT INTO public.lease_amendment_events(amendment_id,actor_id,event_type,snapshot) VALUES(m.id,auth.uid(),'draft_saved',to_jsonb(m));
 RETURN m.id;
END;
$$;

CREATE FUNCTION private.act_on_lease_amendment(p_id uuid,p_action text,p_revision integer,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.lease_agreements%ROWTYPE; m public.lease_amendments%ROWTYPE; manager boolean; recipient uuid; event text;
BEGIN
 SELECT * INTO m FROM public.lease_amendments WHERE id=p_id;
 IF NOT FOUND OR NOT private.amendment_access(m.agreement_id) THEN RAISE EXCEPTION 'Нет доступа к предложению' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.lease_agreements WHERE id=m.agreement_id FOR UPDATE;
 SELECT * INTO m FROM public.lease_amendments WHERE id=p_id FOR UPDATE;
 IF NOT private.amendment_access(a.id) THEN RAISE EXCEPTION 'Нет доступа к предложению' USING ERRCODE='42501'; END IF;
 manager:=private.amendment_access(a.id,true);
 IF p_action IS NULL OR p_action NOT IN ('submit','accept','reject','cancel') THEN RAISE EXCEPTION 'Неизвестное действие' USING ERRCODE='23514'; END IF;
 IF (p_action IN ('submit','cancel')) IS DISTINCT FROM manager THEN RAISE EXCEPTION 'Это действие доступно другой стороне договора' USING ERRCODE='42501'; END IF;
 IF (p_action='accept' AND m.status='accepted') OR (p_action='cancel' AND m.status='cancelled') THEN RETURN m.id; END IF;
 IF m.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Предложение изменилось. Обновите данные' USING ERRCODE='40001'; END IF;
 IF char_length(p_note)>2000 THEN RAISE EXCEPTION 'Сократите комментарий до 2000 символов' USING ERRCODE='23514'; END IF;
 IF p_action='cancel' THEN
  IF m.status NOT IN ('draft','pending') THEN RAISE EXCEPTION 'Отменить можно только незавершённое предложение' USING ERRCODE='23514'; END IF;
  event:='cancelled';
 ELSE
  IF a.status<>'active' THEN RAISE EXCEPTION 'Договор больше не действует' USING ERRCODE='23514'; END IF;
  IF (p_action='submit' AND m.status<>'draft') OR (p_action IN ('accept','reject') AND m.status<>'pending') THEN RAISE EXCEPTION 'Предложение больше не ожидает этого действия' USING ERRCODE='23514'; END IF;
  IF p_action IN ('submit','accept') AND m.effective_from<CURRENT_DATE THEN RAISE EXCEPTION 'Дата изменения уже прошла. Создайте новое предложение' USING ERRCODE='23514'; END IF;
  IF p_action IN ('submit','accept') AND to_jsonb(a) IS DISTINCT FROM (m.agreement_snapshot - ARRAY['property_name','property_address','tenant_name','tenant_email','owner_name','owner_email']) THEN
   RAISE EXCEPTION 'Условия договора изменились. Пересохраните черновик предложения' USING ERRCODE='40001';
  END IF;
  IF p_action='submit' THEN
   SELECT user_id INTO recipient FROM public.tenants WHERE id=a.tenant_id;
   IF recipient IS NULL THEN RAISE EXCEPTION 'Сначала подключите кабинет арендатора' USING ERRCODE='23514'; END IF;
   m.submitted_at:=clock_timestamp();event:='submitted';
  ELSIF p_action='reject' THEN
   IF NULLIF(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Укажите причину отказа' USING ERRCODE='23514'; END IF;
   m.review_note:=btrim(p_note);m.decided_at:=clock_timestamp();event:='rejected';recipient:=a.owner_id;
  ELSE
   PERFORM id FROM public.rent_charges WHERE agreement_id=a.id AND charge_type='rent' AND period_start>=m.effective_from ORDER BY id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.rent_charges c WHERE c.agreement_id=a.id AND c.charge_type='rent' AND c.period_start>=m.effective_from AND c.amount<>m.monthly_payment
    AND (c.paid_amount>0 OR c.paid_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.payment_reports r WHERE r.charge_id=c.id AND r.status='pending'))) THEN
    RAISE EXCEPTION 'За затронутые месяцы уже есть оплата или сообщение о ней. Сначала проверьте платежи' USING ERRCODE='23514';
   END IF;
   IF EXISTS(SELECT 1 FROM public.rent_charges c WHERE c.agreement_id=a.id AND c.charge_type='rent' AND c.period_start>=m.effective_from AND m.monthly_payment+c.adjustment_amount<0) THEN
    RAISE EXCEPTION 'Проверьте корректировки начислений: новая итоговая сумма не может быть отрицательной' USING ERRCODE='23514';
   END IF;
   m.decided_at:=clock_timestamp();event:='accepted';recipient:=a.owner_id;
  END IF;
 END IF;
 UPDATE public.lease_amendments SET status=CASE event WHEN 'submitted' THEN 'pending' ELSE event END,submitted_at=m.submitted_at,decided_at=m.decided_at,
  review_note=m.review_note,revision=revision+1,updated_at=clock_timestamp() WHERE id=m.id RETURNING * INTO m;
 IF event='accepted' THEN
  -- The schedule trigger reads the now-accepted rate; no midnight job is required.
  UPDATE public.lease_agreements SET end_date=m.end_date WHERE id=a.id;
 END IF;
 INSERT INTO public.lease_amendment_events(amendment_id,actor_id,event_type,snapshot) VALUES(m.id,auth.uid(),event,to_jsonb(m));
 IF manager THEN SELECT user_id INTO recipient FROM public.tenants WHERE id=a.tenant_id; END IF;
 IF recipient IS NOT NULL AND m.submitted_at IS NOT NULL THEN
  INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id,dedupe_key)
  VALUES(recipient,'agreement_amendment','Изменение условий аренды',CASE event WHEN 'submitted' THEN 'Проверьте новую ставку и срок договора.' WHEN 'accepted' THEN 'Арендатор подтвердил новые условия.' WHEN 'rejected' THEN 'Арендатор отклонил предложение: '||left(m.review_note,900) ELSE 'Предложение отменено.' END,
   '/lease-changes','agreement',a.id,'amendment:'||m.id::text||':'||m.revision::text);
 END IF;
 RETURN m.id;
END;
$$;
REVOKE ALL ON FUNCTION private.save_lease_amendment(uuid,uuid,jsonb,integer),private.act_on_lease_amendment(uuid,text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.save_lease_amendment(uuid,uuid,jsonb,integer),private.act_on_lease_amendment(uuid,text,integer,text) TO authenticated,service_role;
CREATE FUNCTION public.save_lease_amendment(p_agreement_id uuid,p_values jsonb,p_id uuid DEFAULT NULL,p_revision integer DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.save_lease_amendment(p_agreement_id,p_id,p_values,p_revision);$$;
CREATE FUNCTION public.act_on_lease_amendment(p_id uuid,p_action text,p_revision integer,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT private.act_on_lease_amendment(p_id,p_action,p_revision,p_note);$$;
REVOKE ALL ON FUNCTION public.save_lease_amendment(uuid,jsonb,uuid,integer),public.act_on_lease_amendment(uuid,text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_lease_amendment(uuid,jsonb,uuid,integer),public.act_on_lease_amendment(uuid,text,integer,text) TO authenticated,service_role;

-- Direct edits cannot invalidate a published or accepted addendum. RPCs recheck
-- participants before changing terms under the agreement lock.
CREATE FUNCTION private.guard_amended_agreement() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status='active' AND EXISTS(SELECT 1 FROM public.lease_amendments WHERE agreement_id=OLD.id AND status='pending') THEN
  RAISE EXCEPTION 'Сначала завершите или отмените предложение об изменении условий' USING ERRCODE='23514';
 END IF;
 IF current_user IN ('authenticated','anon') AND EXISTS(SELECT 1 FROM public.lease_amendments WHERE agreement_id=OLD.id AND status IN ('pending','accepted'))
  AND (NEW.owner_id,NEW.tenant_id,NEW.property_id,NEW.unit_id,NEW.start_date,NEW.end_date,NEW.monthly_payment,NEW.payment_due_day,NEW.contract_details,NEW.document_file,NEW.signed_document_file)
   IS DISTINCT FROM (OLD.owner_id,OLD.tenant_id,OLD.property_id,OLD.unit_id,OLD.start_date,OLD.end_date,OLD.monthly_payment,OLD.payment_due_day,OLD.contract_details,OLD.document_file,OLD.signed_document_file) THEN
  RAISE EXCEPTION 'Условия закреплены дополнительным соглашением. Создайте новое изменение условий' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_amended_agreement() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_amended_agreement BEFORE UPDATE ON public.lease_agreements FOR EACH ROW EXECUTE FUNCTION private.guard_amended_agreement();
ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid CHECK(kind IN (
 'request_created','request_comment','request_status','agreement_created','agreement_status','agreement_accepted','agreement_expiring',
 'payment_status','payment_due','payment_overdue','payment_reminder','payment_reported','payment_report_status','utility_submitted','utility_reviewed','handover_status','agreement_amendment'));

CREATE OR REPLACE FUNCTION private.sync_rent_charges_for_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.rent_charges AS charge
  WHERE charge.charge_type = 'rent'
    AND charge.agreement_id = NEW.id
    AND charge.paid_at IS NULL
    AND charge.paid_amount = 0
    AND charge.period_start >= date_trunc('month', CURRENT_DATE)::date
    AND (
      (NEW.status <> 'active' AND charge.period_start > date_trunc('month', CURRENT_DATE)::date)
      OR (NEW.status = 'active' AND (charge.period_start < date_trunc('month', NEW.start_date)::date
      OR charge.period_start > date_trunc('month', NEW.end_date)::date))
    );

  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.rent_charges (
    agreement_id, owner_id, tenant_id, period_start, due_date, amount
  )
  SELECT
    NEW.id,
    NEW.owner_id,
    NEW.tenant_id,
    months.period_start::date,
    LEAST(
      months.period_start::date
        + (COALESCE(NEW.payment_due_day, EXTRACT(DAY FROM NEW.start_date)::integer) - 1),
      (months.period_start + INTERVAL '1 month - 1 day')::date
    ),
    private.agreement_rent_at(NEW.id,months.period_start::date,NEW.monthly_payment)::numeric(14, 2)
  FROM generate_series(
    date_trunc('month', NEW.start_date::timestamp),
    date_trunc('month', NEW.end_date::timestamp),
    INTERVAL '1 month'
  ) AS months(period_start)
  ON CONFLICT (agreement_id, period_start, charge_type) DO UPDATE
  SET
    owner_id = EXCLUDED.owner_id,
    tenant_id = EXCLUDED.tenant_id,
    due_date = EXCLUDED.due_date,
    amount = EXCLUDED.amount
  WHERE public.rent_charges.paid_at IS NULL
    AND public.rent_charges.paid_amount = 0
    AND public.rent_charges.period_start >= date_trunc('month', CURRENT_DATE)::date;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.sync_rent_charges_for_agreement()
  FROM PUBLIC, anon, authenticated, service_role;
