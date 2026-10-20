SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.lease_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('move_in','move_out')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','confirmed','disputed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  inspection_date date NOT NULL,
  keys_count integer NOT NULL CHECK (keys_count BETWEEN 0 AND 100),
  checklist jsonb NOT NULL CHECK (jsonb_typeof(checklist) = 'object'),
  inventory_snapshot jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(inventory_snapshot) = 'array'),
  condition_note text NOT NULL DEFAULT '' CHECK (char_length(condition_note) <= 4000),
  meter_readings text NOT NULL DEFAULT '' CHECK (char_length(meter_readings) <= 2000),
  photos text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photos) <= 12),
  deductions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(deductions) = 'array'),
  deposit_received numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit_received >= 0 AND deposit_received < 1000000000),
  deductions_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (deductions_total >= 0 AND deductions_total <= deposit_received),
  refund_due numeric(14,2) GENERATED ALWAYS AS (CASE WHEN kind = 'move_out' THEN deposit_received - deductions_total ELSE 0 END) STORED,
  review_note text CHECK (char_length(review_note) <= 2000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  refund_marked_at timestamptz,
  refund_confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agreement_id, kind),
  CHECK (status <> 'disputed' OR NULLIF(btrim(review_note),'') IS NOT NULL),
  CHECK (status <> 'confirmed' OR reviewed_at IS NOT NULL),
  CHECK (refund_marked_at IS NULL OR (kind = 'move_out' AND status = 'confirmed')),
  CHECK (refund_confirmed_at IS NULL OR refund_marked_at IS NOT NULL),
  CHECK (completed_at IS NULL OR (kind = 'move_out' AND status = 'confirmed'))
);
CREATE TABLE public.lease_handover_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id uuid NOT NULL REFERENCES public.lease_handovers(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('draft_saved','submitted','confirmed','disputed','refund_marked','refund_confirmed','completed')),
  note text,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lease_handover_events_report_created_idx ON public.lease_handover_events(handover_id, created_at, id);
CREATE INDEX lease_handover_events_actor_idx ON public.lease_handover_events(actor_id);
ALTER TABLE public.lease_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lease_handover_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lease_handovers, public.lease_handover_events FROM anon, authenticated;
GRANT SELECT ON public.lease_handovers, public.lease_handover_events TO authenticated;
GRANT ALL ON public.lease_handovers, public.lease_handover_events TO service_role;

CREATE FUNCTION private.handover_access(p_agreement_id uuid, p_owner_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.lease_agreements a WHERE a.id = p_agreement_id AND (
      a.owner_id = auth.uid() OR (NOT p_owner_only AND EXISTS (
        SELECT 1 FROM public.tenants t WHERE t.id = a.tenant_id AND t.user_id = auth.uid()
      ))
    )
  );
$$;
REVOKE ALL ON FUNCTION private.handover_access(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.handover_access(uuid,boolean) TO authenticated, service_role;
CREATE POLICY handover_participant_read ON public.lease_handovers FOR SELECT TO authenticated USING (
  private.handover_access(agreement_id,true) OR (status <> 'draft' AND private.handover_access(agreement_id))
);
CREATE POLICY handover_event_participant_read ON public.lease_handover_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.lease_handovers h WHERE h.id = handover_id
    AND (event_type <> 'draft_saved' OR private.handover_access(h.agreement_id,true)))
);

CREATE FUNCTION private.save_lease_handover(p_agreement_id uuid, p_kind text, p_report jsonb, p_expected_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.lease_agreements%ROWTYPE;
  h public.lease_handovers%ROWTYPE;
  received numeric;
  retained numeric := 0;
  deduction jsonb;
  checks jsonb := p_report->'checklist';
  photos_value text[];
  inspection date := (p_report->>'inspection_date')::date;
BEGIN
  IF NOT private.handover_access(p_agreement_id,true) THEN
    RAISE EXCEPTION 'Нет доступа к акту' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.lease_agreements WHERE id = p_agreement_id FOR UPDATE;
  IF NOT private.handover_access(p_agreement_id,true) THEN
    RAISE EXCEPTION 'Нет доступа к акту' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('move_in','move_out') OR a.status NOT IN ('active','completed')
    OR (p_kind = 'move_in' AND a.status <> 'active') THEN
    RAISE EXCEPTION 'Для осмотра нужен активный договор; выезд доступен и после завершения' USING ERRCODE = '23514';
  END IF;
  IF inspection IS NULL OR inspection < a.start_date OR inspection > CURRENT_DATE THEN
    RAISE EXCEPTION 'Дата осмотра должна быть от начала аренды до сегодня' USING ERRCODE = '23514';
  END IF;
  IF (p_report->>'keys_count') IS NULL OR (p_report->>'keys_count') !~ '^[0-9]{1,3}$'
    OR (p_report->>'keys_count')::integer > 100 THEN
    RAISE EXCEPTION 'Укажите количество ключей от 0 до 100' USING ERRCODE = '23514';
  END IF;
  IF checks IS NULL OR jsonb_typeof(checks) <> 'object' OR NOT checks ?& ARRAY['condition','inventory','meters','keys'] THEN
    RAISE EXCEPTION 'Заполните чек-лист осмотра' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(checks) e WHERE e.key NOT IN ('condition','inventory','meters','keys') OR jsonb_typeof(e.value) <> 'boolean') THEN
    RAISE EXCEPTION 'Проверьте чек-лист осмотра' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_report->>'deposit_received','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Укажите полученный депозит с точностью до копеек' USING ERRCODE = '23514';
  END IF;
  received := (p_report->>'deposit_received')::numeric;
  IF p_report->'deductions' IS NULL OR jsonb_typeof(p_report->'deductions') <> 'array'
    OR jsonb_array_length(p_report->'deductions') > 20 THEN
    RAISE EXCEPTION 'Допускается до 20 удержаний' USING ERRCODE = '23514';
  END IF;
  FOR deduction IN SELECT value FROM jsonb_array_elements(p_report->'deductions') LOOP
    IF NULLIF(btrim(deduction->>'reason'),'') IS NULL OR char_length(deduction->>'reason') > 500
      OR COALESCE(deduction->>'amount','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
      OR (deduction->>'amount')::numeric <= 0 THEN
      RAISE EXCEPTION 'Для удержания укажите причину и положительную сумму до копеек' USING ERRCODE = '23514';
    END IF;
    retained := retained + (deduction->>'amount')::numeric;
  END LOOP;
  IF retained > received OR (p_kind = 'move_in' AND jsonb_array_length(p_report->'deductions') > 0) THEN
    RAISE EXCEPTION 'Удержания доступны при выезде и не могут превышать депозит' USING ERRCODE = '23514';
  END IF;
  IF char_length(COALESCE(p_report->>'condition_note','')) > 4000 OR char_length(COALESCE(p_report->>'meter_readings','')) > 2000 THEN
    RAISE EXCEPTION 'Сократите описание осмотра или показания' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_report->'photos') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Проверьте фотографии' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(array_agg(value),'{}') INTO photos_value FROM jsonb_array_elements_text(p_report->'photos');
  IF cardinality(photos_value) > 12 OR EXISTS (
    SELECT 1 FROM unnest(photos_value) path WHERE path NOT LIKE auth.uid()::text || '/' || a.id::text || '/' || p_kind || '/%'
      OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'lease-handover-photos' AND o.name = path AND o.owner_id = auth.uid()::text)
  ) THEN RAISE EXCEPTION 'Фотографии должны быть загружены вами для этого осмотра' USING ERRCODE = '42501'; END IF;
  SELECT * INTO h FROM public.lease_handovers WHERE agreement_id = a.id AND kind = p_kind FOR UPDATE;
  IF FOUND THEN
    IF h.status NOT IN ('draft','disputed') THEN RAISE EXCEPTION 'Отправленный или подтверждённый акт нельзя изменять' USING ERRCODE = '23514'; END IF;
    IF p_expected_revision IS DISTINCT FROM h.revision THEN RAISE EXCEPTION 'Акт изменился. Обновите данные и повторите действие' USING ERRCODE = '40001'; END IF;
    UPDATE public.lease_handovers SET inspection_date = inspection, keys_count = (p_report->>'keys_count')::integer,
      checklist = checks, condition_note = COALESCE(p_report->>'condition_note',''), meter_readings = COALESCE(p_report->>'meter_readings',''),
      photos = photos_value, deductions = p_report->'deductions', deposit_received = received, deductions_total = retained,
      inventory_snapshot = CASE WHEN jsonb_typeof(a.contract_details->'inventoryItems') = 'array' THEN a.contract_details->'inventoryItems' ELSE '[]'::jsonb END,
      status = 'draft', review_note = NULL, reviewed_at = NULL, submitted_at = NULL, revision = revision + 1, updated_at = clock_timestamp()
    WHERE id = h.id RETURNING * INTO h;
  ELSE
    IF p_expected_revision IS NOT NULL THEN RAISE EXCEPTION 'Акт изменился. Обновите данные и повторите действие' USING ERRCODE = '40001'; END IF;
    INSERT INTO public.lease_handovers(agreement_id,kind,inspection_date,keys_count,checklist,condition_note,meter_readings,photos,deductions,deposit_received,deductions_total,inventory_snapshot)
    VALUES (a.id,p_kind,inspection,(p_report->>'keys_count')::integer,checks,COALESCE(p_report->>'condition_note',''),COALESCE(p_report->>'meter_readings',''),photos_value,p_report->'deductions',received,retained,CASE WHEN jsonb_typeof(a.contract_details->'inventoryItems') = 'array' THEN a.contract_details->'inventoryItems' ELSE '[]'::jsonb END)
    RETURNING * INTO h;
  END IF;
  INSERT INTO public.lease_handover_events(handover_id,actor_id,event_type,snapshot) VALUES (h.id,auth.uid(),'draft_saved',to_jsonb(h));
  RETURN h.id;
END;
$$;

CREATE FUNCTION private.act_on_lease_handover(p_handover_id uuid, p_action text, p_expected_revision integer, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  h public.lease_handovers%ROWTYPE;
  a public.lease_agreements%ROWTYPE;
  owner_action boolean;
  event_kind text;
  recipient uuid;
BEGIN
  SELECT * INTO h FROM public.lease_handovers WHERE id = p_handover_id;
  IF NOT FOUND OR NOT private.handover_access(h.agreement_id) THEN RAISE EXCEPTION 'Нет доступа к акту' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.lease_agreements WHERE id = h.agreement_id FOR UPDATE;
  SELECT * INTO h FROM public.lease_handovers WHERE id = p_handover_id FOR UPDATE;
  IF NOT private.handover_access(h.agreement_id) THEN RAISE EXCEPTION 'Нет доступа к акту' USING ERRCODE = '42501'; END IF;
  owner_action := a.owner_id = auth.uid();
  IF p_action IS NULL OR p_action NOT IN ('submit','confirm','dispute','mark_refunded','confirm_refund','complete') THEN
    RAISE EXCEPTION 'Неизвестное действие' USING ERRCODE = '23514';
  END IF;
  IF (p_action IN ('submit','mark_refunded','complete')) IS DISTINCT FROM owner_action THEN
    RAISE EXCEPTION 'Это действие доступно другой стороне договора' USING ERRCODE = '42501';
  END IF;
  IF char_length(p_note) > 2000 THEN RAISE EXCEPTION 'Комментарий не должен превышать 2000 символов' USING ERRCODE = '23514'; END IF;
  -- Retried final actions never duplicate a return or change the accepted inspection.
  IF (p_action = 'mark_refunded' AND h.refund_marked_at IS NOT NULL)
    OR (p_action = 'confirm_refund' AND h.refund_confirmed_at IS NOT NULL)
    OR (p_action = 'complete' AND h.completed_at IS NOT NULL) THEN RETURN h.id; END IF;
  IF p_expected_revision IS DISTINCT FROM h.revision THEN RAISE EXCEPTION 'Акт изменился. Обновите данные и повторите действие' USING ERRCODE = '40001'; END IF;
  IF p_action = 'submit' THEN
    IF h.status <> 'draft' OR a.status NOT IN ('active','completed') OR (h.kind = 'move_in' AND a.status <> 'active') THEN
      RAISE EXCEPTION 'Отправить можно только черновик акта' USING ERRCODE = '23514';
    END IF;
    IF h.inspection_date < a.start_date OR h.inspection_date > CURRENT_DATE
      OR h.checklist <> '{"condition":true,"inventory":true,"meters":true,"keys":true}'::jsonb
      OR NULLIF(btrim(h.condition_note),'') IS NULL OR NULLIF(btrim(h.meter_readings),'') IS NULL THEN
      RAISE EXCEPTION 'Завершите чек-лист, опишите состояние и показания счётчиков' USING ERRCODE = '23514';
    END IF;
    SELECT user_id INTO recipient FROM public.tenants WHERE id = a.tenant_id;
    IF recipient IS NULL THEN RAISE EXCEPTION 'Сначала подключите кабинет арендатора' USING ERRCODE = '23514'; END IF;
    h.status := 'pending'; h.submitted_at := clock_timestamp(); event_kind := 'submitted';
  ELSIF p_action IN ('confirm','dispute') THEN
    IF h.status <> 'pending' THEN RAISE EXCEPTION 'Акт больше не ожидает решения' USING ERRCODE = '23514'; END IF;
    IF p_action = 'dispute' AND NULLIF(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Опишите замечания к акту' USING ERRCODE = '23514'; END IF;
    h.status := CASE WHEN p_action = 'confirm' THEN 'confirmed' ELSE 'disputed' END;
    h.review_note := NULLIF(btrim(p_note),''); h.reviewed_at := clock_timestamp();
    recipient := a.owner_id; event_kind := h.status;
  ELSE
    IF h.kind <> 'move_out' OR h.status <> 'confirmed' THEN RAISE EXCEPTION 'Сначала согласуйте акт выезда с арендатором' USING ERRCODE = '23514'; END IF;
    IF p_action = 'mark_refunded' THEN
      IF h.refund_due <= 0 THEN RAISE EXCEPTION 'По этому акту возврат не требуется' USING ERRCODE = '23514'; END IF;
      h.refund_marked_at := clock_timestamp(); event_kind := 'refund_marked';
      SELECT user_id INTO recipient FROM public.tenants WHERE id = a.tenant_id;
    ELSIF p_action = 'confirm_refund' THEN
      IF h.refund_marked_at IS NULL THEN RAISE EXCEPTION 'Собственник ещё не отметил возврат' USING ERRCODE = '23514'; END IF;
      h.refund_confirmed_at := clock_timestamp(); event_kind := 'refund_confirmed'; recipient := a.owner_id;
    ELSE
      IF a.status NOT IN ('active','completed') THEN RAISE EXCEPTION 'Договор нельзя завершить' USING ERRCODE = '23514'; END IF;
      IF EXISTS (SELECT 1 FROM public.utility_bills WHERE agreement_id = a.id AND status = 'pending') THEN
        RAISE EXCEPTION 'Сначала проверьте отправленные коммунальные показания' USING ERRCODE = '23514';
      END IF;
      IF a.status = 'active' THEN
        UPDATE public.lease_agreements SET status = 'completed', end_date = LEAST(end_date,h.inspection_date) WHERE id = a.id;
      END IF;
      h.completed_at := clock_timestamp(); event_kind := 'completed';
      SELECT user_id INTO recipient FROM public.tenants WHERE id = a.tenant_id;
    END IF;
  END IF;
  UPDATE public.lease_handovers SET status = h.status, review_note = h.review_note, submitted_at = h.submitted_at,
    reviewed_at = h.reviewed_at, refund_marked_at = h.refund_marked_at, refund_confirmed_at = h.refund_confirmed_at,
    completed_at = h.completed_at, revision = revision + 1, updated_at = clock_timestamp()
  WHERE id = h.id RETURNING * INTO h;
  INSERT INTO public.lease_handover_events(handover_id,actor_id,event_type,note,snapshot)
  VALUES (h.id,auth.uid(),event_kind,NULLIF(btrim(p_note),''),to_jsonb(h));
  IF recipient IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,kind,title,body,href,entity_type,entity_id,dedupe_key)
    VALUES(recipient,'handover_status', CASE WHEN h.kind = 'move_in' THEN 'Акт заселения обновлён' ELSE 'Акт выезда обновлён' END,
      CASE event_kind WHEN 'submitted' THEN 'Проверьте осмотр и расчёт депозита в разделе «Заселение и выезд».'
        WHEN 'disputed' THEN 'Арендатор оставил замечания: ' || left(h.review_note,900)
        WHEN 'confirmed' THEN 'Арендатор подтвердил акт.' WHEN 'refund_marked' THEN 'Собственник отметил возврат депозита. Подтвердите получение после поступления денег.'
        WHEN 'refund_confirmed' THEN 'Арендатор подтвердил получение депозита.' ELSE 'Аренда завершена. История и расчёт депозита сохранены.' END,
      '/handover','agreement',a.id,'handover:' || h.id::text || ':' || h.revision::text);
  END IF;
  RETURN h.id;
END;
$$;
REVOKE ALL ON FUNCTION private.save_lease_handover(uuid,text,jsonb,integer), private.act_on_lease_handover(uuid,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.save_lease_handover(uuid,text,jsonb,integer), private.act_on_lease_handover(uuid,text,integer,text) TO authenticated, service_role;
CREATE FUNCTION public.save_lease_handover(p_agreement_id uuid, p_kind text, p_report jsonb, p_expected_revision integer DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.save_lease_handover(p_agreement_id,p_kind,p_report,p_expected_revision); $$;
CREATE FUNCTION public.act_on_lease_handover(p_handover_id uuid, p_action text, p_expected_revision integer, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT private.act_on_lease_handover(p_handover_id,p_action,p_expected_revision,p_note); $$;
REVOKE ALL ON FUNCTION public.save_lease_handover(uuid,text,jsonb,integer), public.act_on_lease_handover(uuid,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_lease_handover(uuid,text,jsonb,integer), public.act_on_lease_handover(uuid,text,integer,text) TO authenticated, service_role;

CREATE FUNCTION private.protect_handover_agreement_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.owner_id,NEW.tenant_id,NEW.property_id,NEW.unit_id) IS DISTINCT FROM (OLD.owner_id,OLD.tenant_id,OLD.property_id,OLD.unit_id)
    AND EXISTS(SELECT 1 FROM public.lease_handovers WHERE agreement_id = OLD.id) THEN
    RAISE EXCEPTION 'Для смены сторон или объекта с актами создайте новый договор' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_handover_agreement_identity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_handover_agreement_identity BEFORE UPDATE OF owner_id,tenant_id,property_id,unit_id ON public.lease_agreements
FOR EACH ROW EXECUTE FUNCTION private.protect_handover_agreement_identity();

ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid CHECK (kind IN (
  'request_created','request_comment','request_status','agreement_created','agreement_status','agreement_accepted','agreement_expiring',
  'payment_status','payment_due','payment_overdue','payment_reminder','payment_reported','payment_report_status','utility_submitted','utility_reviewed','handover_status'
));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('lease-handover-photos','lease-handover-photos',false,8388608,ARRAY['image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
CREATE POLICY handover_photos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'lease-handover-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND (storage.foldername(name))[3] IN ('move_in','move_out')
  AND EXISTS(SELECT 1 FROM public.lease_agreements a WHERE a.id::text = (storage.foldername(name))[2] AND private.handover_access(a.id,true))
);
CREATE POLICY handover_photos_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'lease-handover-photos' AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR EXISTS(SELECT 1 FROM public.lease_handovers h WHERE objects.name = ANY(h.photos))
    OR EXISTS(SELECT 1 FROM public.lease_handover_events e WHERE e.snapshot->'photos' ? objects.name))
);
CREATE POLICY handover_photos_delete_unattached ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'lease-handover-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND NOT EXISTS(SELECT 1 FROM public.lease_handovers h WHERE objects.name = ANY(h.photos))
  AND NOT EXISTS(SELECT 1 FROM public.lease_handover_events e WHERE e.snapshot->'photos' ? objects.name)
);

-- Preserve existing debt when a lease ends; only future unpaid periods are removed.
CREATE FUNCTION private.limit_completed_lease_date() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'active' THEN
    NEW.end_date := LEAST(OLD.end_date,NEW.end_date,CURRENT_DATE);
    IF NEW.end_date < NEW.start_date THEN RAISE EXCEPTION 'Нельзя завершить аренду до даты её начала' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.limit_completed_lease_date() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER limit_completed_lease_date BEFORE UPDATE OF status ON public.lease_agreements FOR EACH ROW EXECUTE FUNCTION private.limit_completed_lease_date();
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
    NEW.monthly_payment::numeric(14, 2)
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
