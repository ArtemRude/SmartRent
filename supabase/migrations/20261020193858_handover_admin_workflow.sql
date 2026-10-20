-- Administrators already manage leases. Apply the same authority to the owner's
-- handover actions; tenant approval and receipt confirmation remain separate.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION private.handover_access(p_agreement_id uuid, p_owner_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.lease_agreements a WHERE a.id = p_agreement_id AND (
      a.owner_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role) OR (NOT p_owner_only AND EXISTS (
        SELECT 1 FROM public.tenants t WHERE t.id = a.tenant_id AND t.user_id = auth.uid()
      ))
    )
  );
$$;

CREATE OR REPLACE FUNCTION private.save_lease_handover(p_agreement_id uuid, p_kind text, p_report jsonb, p_expected_revision integer)
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
  SELECT * INTO h FROM public.lease_handovers WHERE agreement_id = a.id AND kind = p_kind FOR UPDATE;
  IF cardinality(photos_value) > 12 OR EXISTS (
    SELECT 1 FROM unnest(photos_value) AS input(photo_path)
    WHERE photo_path IS NULL
      OR NOT EXISTS (SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'lease-handover-photos' AND o.name = photo_path)
      OR (NOT COALESCE(photo_path = ANY(h.photos),false) AND (
        photo_path NOT LIKE auth.uid()::text || '/' || a.id::text || '/' || p_kind || '/%'
        OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'lease-handover-photos'
          AND o.name = photo_path AND o.owner_id = auth.uid()::text)
      ))
  ) THEN RAISE EXCEPTION 'Фотографии должны быть загружены вами для этого осмотра' USING ERRCODE = '42501'; END IF;

  IF h.id IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION private.act_on_lease_handover(p_handover_id uuid, p_action text, p_expected_revision integer, p_note text)
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
  owner_action := private.handover_access(a.id,true);
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

-- CREATE OR REPLACE preserves existing function grants. Reassert the API boundary.
REVOKE ALL ON FUNCTION private.handover_access(uuid,boolean), private.save_lease_handover(uuid,text,jsonb,integer), private.act_on_lease_handover(uuid,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.handover_access(uuid,boolean), private.save_lease_handover(uuid,text,jsonb,integer), private.act_on_lease_handover(uuid,text,integer,text) TO authenticated, service_role;
