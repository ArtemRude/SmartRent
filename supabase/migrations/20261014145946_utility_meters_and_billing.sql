SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Separate utility charges reuse the payment ledger without changing rent amounts.
ALTER TABLE public.rent_charges
  ADD COLUMN charge_type text NOT NULL DEFAULT 'rent'
    CHECK (charge_type IN ('rent', 'utilities')),
  DROP CONSTRAINT rent_charges_agreement_period_unique,
  ADD CONSTRAINT rent_charges_agreement_period_type_unique
    UNIQUE (agreement_id, period_start, charge_type);

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
      NEW.status <> 'active'
      OR charge.period_start < date_trunc('month', NEW.start_date)::date
      OR charge.period_start > date_trunc('month', NEW.end_date)::date
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

CREATE OR REPLACE FUNCTION private.audit_rent_charge_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.charge_type = 'utilities' THEN
    RAISE EXCEPTION 'Утверждённый коммунальный расчёт нельзя корректировать вручную' USING ERRCODE = '23514';
  END IF;

  IF OLD.paid_at IS NOT NULL OR OLD.paid_amount > 0 THEN
    RAISE EXCEPTION 'rent charges with payments cannot be adjusted'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NULLIF(btrim(NEW.adjustment_reason), '') IS NULL
    OR (
      OLD.adjustment_amount IS DISTINCT FROM NEW.adjustment_amount
      AND OLD.adjustment_reason IS NOT DISTINCT FROM NEW.adjustment_reason
    )
  THEN
    RAISE EXCEPTION 'adjustment reason is required'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.adjustment_reason := btrim(NEW.adjustment_reason);
  NEW.adjusted_at := now();
  NEW.adjusted_by := (SELECT auth.uid());

  INSERT INTO public.rent_charge_adjustment_events (
    charge_id, previous_adjustment_amount, adjustment_amount, reason, changed_by
  )
  VALUES (
    NEW.id, OLD.adjustment_amount, NEW.adjustment_amount, NEW.adjustment_reason, NEW.adjusted_by
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.audit_rent_charge_adjustment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.utility_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN ('meter', 'fixed')),
  unit text NOT NULL CHECK (char_length(btrim(unit)) BETWEEN 1 AND 20),
  rate numeric(12,4) NOT NULL CHECK (rate > 0 AND rate < 100000000),
  initial_reading numeric(12,3) NOT NULL DEFAULT 0 CHECK (initial_reading >= 0 AND initial_reading < 1000000000),
  start_period date NOT NULL CHECK (start_period = date_trunc('month', start_period)::date),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'meter' OR initial_reading = 0)
);
CREATE INDEX utility_services_agreement_idx ON public.utility_services(agreement_id);

CREATE TABLE public.utility_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.lease_agreements(id) ON DELETE CASCADE,
  period_start date NOT NULL CHECK (period_start = date_trunc('month', period_start)::date),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text CHECK (char_length(review_note) <= 1000),
  charge_id uuid UNIQUE REFERENCES public.rent_charges(id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND charge_id IS NULL)
    OR (status = 'rejected' AND reviewed_at IS NOT NULL AND charge_id IS NULL
      AND NULLIF(btrim(review_note), '') IS NOT NULL)
    OR (status = 'approved' AND reviewed_at IS NOT NULL
      AND ((amount = 0 AND charge_id IS NULL) OR (amount > 0 AND charge_id IS NOT NULL)))
  )
);
CREATE INDEX utility_bills_agreement_period_idx ON public.utility_bills(agreement_id, period_start DESC);
CREATE INDEX utility_bills_submitted_by_idx ON public.utility_bills(submitted_by);
CREATE INDEX utility_bills_reviewed_by_idx ON public.utility_bills(reviewed_by);
-- One pending submission prevents approving readings with an obsolete baseline.
CREATE UNIQUE INDEX utility_bills_one_pending_idx ON public.utility_bills(agreement_id) WHERE status = 'pending';
CREATE UNIQUE INDEX utility_bills_approved_period_idx ON public.utility_bills(agreement_id, period_start) WHERE status = 'approved';

CREATE TABLE public.utility_bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.utility_bills(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.utility_services(id) DEFERRABLE INITIALLY DEFERRED,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('meter', 'fixed')),
  unit text NOT NULL,
  previous_reading numeric(12,3),
  reading numeric(12,3),
  rate numeric(12,4) NOT NULL CHECK (rate > 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  photo_path text CHECK (char_length(photo_path) <= 1000),
  UNIQUE (bill_id, service_id),
  CHECK (
    (kind = 'fixed' AND reading IS NULL AND previous_reading IS NULL AND photo_path IS NULL)
    OR (kind = 'meter' AND reading IS NOT NULL AND previous_reading IS NOT NULL
      AND reading >= previous_reading AND previous_reading >= 0)
  )
);
CREATE INDEX utility_bill_items_service_idx ON public.utility_bill_items(service_id);
CREATE INDEX utility_bill_items_photo_idx ON public.utility_bill_items(photo_path) WHERE photo_path IS NOT NULL;

ALTER TABLE public.utility_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_bill_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.utility_services, public.utility_bills, public.utility_bill_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.utility_services, public.utility_bills, public.utility_bill_items TO authenticated;
GRANT ALL ON public.utility_services, public.utility_bills, public.utility_bill_items TO service_role;

CREATE FUNCTION private.can_use_utilities(p_agreement_id uuid, p_owner_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.lease_agreements AS agreement
    WHERE agreement.id = p_agreement_id AND (
      agreement.owner_id = auth.uid()
      OR private.has_role(auth.uid(), 'admin'::public.app_role)
      OR (NOT p_owner_only AND private.is_my_tenant_record(agreement.tenant_id))
    )
  );
$$;
REVOKE ALL ON FUNCTION private.can_use_utilities(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_use_utilities(uuid, boolean) TO authenticated, service_role;

CREATE POLICY utility_services_participant_select ON public.utility_services FOR SELECT TO authenticated
  USING (private.can_use_utilities(agreement_id));
CREATE POLICY utility_bills_participant_select ON public.utility_bills FOR SELECT TO authenticated
  USING (private.can_use_utilities(agreement_id));
CREATE POLICY utility_bill_items_participant_select ON public.utility_bill_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.utility_bills AS bill WHERE bill.id = utility_bill_items.bill_id));

-- All mutations lock the agreement first, serializing configuration/submission/review.
-- Privileged code stays in private; public RPC wrappers run as the caller.
CREATE FUNCTION private.save_utility_service(p_agreement_id uuid, p_service jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  agreement_row public.lease_agreements%ROWTYPE;
  service_id uuid := NULLIF(p_service->>'id', '')::uuid;
  service_row public.utility_services%ROWTYPE;
  rate_value numeric := (p_service->>'rate')::numeric;
  start_value date := (p_service->>'start_period')::date;
BEGIN
  IF NOT private.can_use_utilities(p_agreement_id, true) THEN
    RAISE EXCEPTION 'Нет доступа к настройкам коммунальных услуг' USING ERRCODE = '42501';
  END IF;
  IF rate_value IS NULL OR rate_value <= 0 OR rate_value >= 100000000
    OR rate_value <> round(rate_value, 4)
    OR (p_service->>'kind' = 'fixed' AND rate_value <> round(rate_value, 2)) THEN
    RAISE EXCEPTION 'Проверьте тариф: до 4 знаков после запятой, фиксированный платёж — до 2' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO agreement_row FROM public.lease_agreements WHERE id = p_agreement_id FOR UPDATE;
  IF NOT private.can_use_utilities(p_agreement_id, true) THEN
    RAISE EXCEPTION 'Нет доступа к настройкам коммунальных услуг' USING ERRCODE = '42501';
  END IF;
  IF agreement_row.status NOT IN ('draft', 'pending_signature', 'active') THEN
    RAISE EXCEPTION 'Настройки завершённого договора нельзя изменять' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.utility_bills WHERE agreement_id = p_agreement_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Сначала проверьте отправленный расчёт' USING ERRCODE = '23514';
  END IF;
  IF service_id IS NOT NULL THEN
    SELECT * INTO service_row FROM public.utility_services WHERE id = service_id AND agreement_id = p_agreement_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Услуга не найдена' USING ERRCODE = '42501'; END IF;
    IF service_row.kind = 'fixed' AND rate_value <> round(rate_value, 2) THEN
      RAISE EXCEPTION 'Фиксированный платёж указывается с точностью до копеек' USING ERRCODE = '23514';
    END IF;
    IF NOT service_row.active AND COALESCE((p_service->>'active')::boolean, true)
      AND (SELECT count(*) FROM public.utility_services WHERE agreement_id = p_agreement_id AND active) >= 24 THEN
      RAISE EXCEPTION 'Доступно не более 24 активных услуг на договор' USING ERRCODE = '23514';
    END IF;
    UPDATE public.utility_services SET rate = rate_value, active = COALESCE((p_service->>'active')::boolean, true)
    WHERE id = service_id;
    RETURN service_id;
  END IF;
  IF COALESCE((p_service->>'initial_reading')::numeric, 0) < 0
    OR COALESCE((p_service->>'initial_reading')::numeric, 0) >= 1000000000
    OR COALESCE((p_service->>'initial_reading')::numeric, 0) <> round(COALESCE((p_service->>'initial_reading')::numeric, 0), 3) THEN
    RAISE EXCEPTION 'Начальные показания указываются с точностью до 0,001' USING ERRCODE = '23514';
  END IF;
  IF start_value IS NULL OR start_value < date_trunc('month', agreement_row.start_date)::date
    OR start_value > date_trunc('month', agreement_row.end_date)::date THEN
    RAISE EXCEPTION 'Первый расчётный месяц должен входить в срок договора' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM public.utility_services WHERE agreement_id = p_agreement_id AND active) >= 24 THEN
    RAISE EXCEPTION 'Доступно не более 24 активных услуг на договор' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.utility_services(agreement_id, name, kind, unit, rate, initial_reading, start_period)
  VALUES (p_agreement_id, btrim(p_service->>'name'), p_service->>'kind', btrim(p_service->>'unit'),
    rate_value, COALESCE((p_service->>'initial_reading')::numeric, 0), start_value)
  RETURNING id INTO service_id;
  RETURN service_id;
END;
$$;

CREATE FUNCTION private.submit_utility_readings(p_agreement_id uuid, p_period date, p_readings jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  agreement_row public.lease_agreements%ROWTYPE;
  service_row public.utility_services%ROWTYPE;
  reading_json jsonb;
  previous_value numeric;
  reading_value numeric;
  last_period date;
  photo_value text;
  line_amount numeric;
  bill_id uuid;
  total_amount numeric := 0;
  service_count integer := 0;
BEGIN
  IF NOT private.can_use_utilities(p_agreement_id) THEN
    RAISE EXCEPTION 'Нет доступа к этому договору' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO agreement_row FROM public.lease_agreements WHERE id = p_agreement_id FOR UPDATE;
  IF NOT private.can_use_utilities(p_agreement_id) THEN
    RAISE EXCEPTION 'Нет доступа к этому договору' USING ERRCODE = '42501';
  END IF;
  IF agreement_row.status <> 'active' OR CURRENT_DATE < agreement_row.start_date OR CURRENT_DATE > agreement_row.end_date THEN
    RAISE EXCEPTION 'Передача показаний доступна во время действующей аренды' USING ERRCODE = '23514';
  END IF;
  IF p_period IS NULL OR p_period <> date_trunc('month', p_period)::date
    OR p_period > date_trunc('month', CURRENT_DATE)::date
    OR p_period < date_trunc('month', agreement_row.start_date)::date
    OR p_period > date_trunc('month', agreement_row.end_date)::date THEN
    RAISE EXCEPTION 'Выберите прошедший или текущий месяц в пределах договора' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(p_readings) IS DISTINCT FROM 'array' OR jsonb_array_length(p_readings) > 24 THEN
    RAISE EXCEPTION 'Некорректный список показаний' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.utility_bills WHERE agreement_id = p_agreement_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Предыдущий расчёт ещё ожидает проверки' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.utility_bills WHERE agreement_id = p_agreement_id AND status = 'approved' AND period_start >= p_period) THEN
    RAISE EXCEPTION 'Этот или более поздний месяц уже утверждён' USING ERRCODE = '23514';
  END IF;
  -- Reject unknown, fixed, duplicate, and not-yet-effective meter IDs.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_readings) AS input(value)
    LEFT JOIN public.utility_services AS service ON service.id::text = input.value->>'service_id'
      AND service.agreement_id = p_agreement_id AND service.kind = 'meter'
      AND service.active AND service.start_period <= p_period
    WHERE service.id IS NULL
  ) OR (SELECT count(DISTINCT value->>'service_id') FROM jsonb_array_elements(p_readings)) <> jsonb_array_length(p_readings) THEN
    RAISE EXCEPTION 'Проверьте список счётчиков' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.utility_bills(agreement_id, period_start, submitted_by)
  VALUES (p_agreement_id, p_period, auth.uid()) RETURNING id INTO bill_id;
  FOR service_row IN SELECT * FROM public.utility_services
    WHERE agreement_id = p_agreement_id AND active AND start_period <= p_period ORDER BY id
  LOOP
    service_count := service_count + 1;
    previous_value := NULL; reading_value := NULL; photo_value := NULL;
    IF service_row.kind = 'meter' THEN
      SELECT value INTO reading_json FROM jsonb_array_elements(p_readings)
        WHERE value->>'service_id' = service_row.id::text;
      IF reading_json IS NULL OR jsonb_typeof(reading_json->'reading') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Передайте показания счётчика «%»', service_row.name USING ERRCODE = '23514';
      END IF;
      reading_value := (reading_json->>'reading')::numeric;
      IF reading_value < 0 OR reading_value >= 1000000000 OR reading_value <> round(reading_value, 3) THEN
        RAISE EXCEPTION 'Показания должны быть положительным числом с точностью до 0,001' USING ERRCODE = '23514';
      END IF;
      SELECT item.reading, bill.period_start INTO previous_value, last_period
        FROM public.utility_bill_items AS item JOIN public.utility_bills AS bill ON bill.id = item.bill_id
        WHERE item.service_id = service_row.id AND bill.status = 'approved'
        ORDER BY bill.period_start DESC LIMIT 1;
      previous_value := COALESCE(previous_value, service_row.initial_reading);
      IF reading_value < previous_value THEN
        RAISE EXCEPTION 'Показания «%» меньше предыдущих (%)', service_row.name, previous_value USING ERRCODE = '23514';
      END IF;
      photo_value := NULLIF(reading_json->>'photo_path', '');
      IF photo_value IS NOT NULL AND (
        split_part(photo_value, '/', 1) <> auth.uid()::text
        OR split_part(photo_value, '/', 2) <> p_agreement_id::text
        OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'utility-reading-photos' AND name = photo_value)
      ) THEN
        RAISE EXCEPTION 'Фотография должна быть загружена вами для этого договора' USING ERRCODE = '42501';
      END IF;
      line_amount := round((reading_value - previous_value) * service_row.rate, 2);
    ELSE
      line_amount := round(service_row.rate, 2);
    END IF;
    IF line_amount >= 1000000000000 THEN
      RAISE EXCEPTION 'Сумма слишком большая. Проверьте показания и тариф' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.utility_bill_items(bill_id, service_id, name, kind, unit, previous_reading, reading, rate, amount, photo_path)
    VALUES (bill_id, service_row.id, service_row.name, service_row.kind, service_row.unit,
      previous_value, reading_value, service_row.rate, line_amount, photo_value);
    total_amount := total_amount + line_amount;
  END LOOP;
  IF service_count = 0 THEN RAISE EXCEPTION 'На этот месяц не настроены коммунальные услуги' USING ERRCODE = '23514'; END IF;
  IF total_amount >= 1000000000000 THEN
    RAISE EXCEPTION 'Сумма слишком большая. Проверьте показания и тариф' USING ERRCODE = '23514';
  END IF;
  UPDATE public.utility_bills SET amount = total_amount WHERE id = bill_id;
  INSERT INTO public.notifications(user_id, kind, title, body, href, entity_type, entity_id, dedupe_key)
  VALUES (agreement_row.owner_id, 'utility_submitted', 'Коммунальный расчёт на проверке',
    'Переданы показания за ' || to_char(p_period, 'MM.YYYY') || '. Сумма: ' || total_amount::text || ' ₽.',
    '/utilities', 'agreement', p_agreement_id, 'utility_submitted:' || bill_id::text);
  RETURN bill_id;
END;
$$;

CREATE FUNCTION private.review_utility_bill(p_bill_id uuid, p_approve boolean, p_note text, p_due_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  bill_row public.utility_bills%ROWTYPE;
  agreement_row public.lease_agreements%ROWTYPE;
  tenant_user_id uuid;
  new_charge_id uuid;
  next_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Выберите результат проверки' USING ERRCODE = '23514'; END IF;
  SELECT * INTO bill_row FROM public.utility_bills WHERE id = p_bill_id;
  IF NOT FOUND OR NOT private.can_use_utilities(bill_row.agreement_id, true) THEN
    RAISE EXCEPTION 'Нет доступа к этому расчёту' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO agreement_row FROM public.lease_agreements WHERE id = bill_row.agreement_id FOR UPDATE;
  IF NOT private.can_use_utilities(bill_row.agreement_id, true) THEN
    RAISE EXCEPTION 'Нет доступа к этому расчёту' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO bill_row FROM public.utility_bills WHERE id = p_bill_id FOR UPDATE;
  -- A retried approval is idempotent and returns the already committed state.
  IF bill_row.status <> 'pending' THEN
    IF bill_row.status = next_status THEN RETURN next_status; END IF;
    RAISE EXCEPTION 'Этот расчёт уже проверен' USING ERRCODE = '23514';
  END IF;
  IF char_length(p_note) > 1000 OR (NOT p_approve AND NULLIF(btrim(p_note), '') IS NULL) THEN
    RAISE EXCEPTION 'Укажите причину возврата, не более 1000 символов' USING ERRCODE = '23514';
  END IF;
  IF p_approve THEN
    IF agreement_row.status <> 'active' OR bill_row.period_start < date_trunc('month', agreement_row.start_date)::date
      OR bill_row.period_start > date_trunc('month', agreement_row.end_date)::date THEN
      RAISE EXCEPTION 'Расчёт больше не входит в действующий договор' USING ERRCODE = '23514';
    END IF;
    IF p_due_date IS NULL OR p_due_date < CURRENT_DATE OR p_due_date > CURRENT_DATE + 366 THEN
      RAISE EXCEPTION 'Укажите срок оплаты от сегодня до года вперёд' USING ERRCODE = '23514';
    END IF;
    IF bill_row.amount > 0 THEN
      INSERT INTO public.rent_charges(agreement_id, owner_id, tenant_id, period_start, due_date, amount, charge_type)
      VALUES (agreement_row.id, agreement_row.owner_id, agreement_row.tenant_id,
        bill_row.period_start, p_due_date, bill_row.amount, 'utilities') RETURNING id INTO new_charge_id;
    END IF;
  END IF;
  UPDATE public.utility_bills SET status = next_status, reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = NULLIF(btrim(p_note), ''), charge_id = new_charge_id WHERE id = p_bill_id;
  SELECT user_id INTO tenant_user_id FROM public.tenants WHERE id = agreement_row.tenant_id;
  IF tenant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, kind, title, body, href, entity_type, entity_id, dedupe_key)
    VALUES (tenant_user_id, 'utility_reviewed',
      CASE WHEN p_approve THEN 'Коммунальный расчёт утверждён' ELSE 'Исправьте коммунальные показания' END,
      CASE WHEN p_approve THEN 'За ' || to_char(bill_row.period_start, 'MM.YYYY') || ': ' || bill_row.amount::text || ' ₽.'
        ELSE btrim(p_note) END,
      '/utilities', 'agreement', agreement_row.id, 'utility_reviewed:' || p_bill_id::text);
  END IF;
  RETURN next_status;
END;
$$;

REVOKE ALL ON FUNCTION private.save_utility_service(uuid, jsonb),
  private.submit_utility_readings(uuid, date, jsonb), private.review_utility_bill(uuid, boolean, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.save_utility_service(uuid, jsonb),
  private.submit_utility_readings(uuid, date, jsonb), private.review_utility_bill(uuid, boolean, text, date) TO authenticated;

CREATE FUNCTION public.save_utility_service(p_agreement_id uuid, p_service jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.save_utility_service(p_agreement_id, p_service);
$$;
CREATE FUNCTION public.submit_utility_readings(p_agreement_id uuid, p_period date, p_readings jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.submit_utility_readings(p_agreement_id, p_period, p_readings);
$$;
CREATE FUNCTION public.review_utility_bill(p_bill_id uuid, p_approve boolean, p_note text, p_due_date date)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.review_utility_bill(p_bill_id, p_approve, p_note, p_due_date);
$$;
REVOKE ALL ON FUNCTION public.save_utility_service(uuid, jsonb),
  public.submit_utility_readings(uuid, date, jsonb), public.review_utility_bill(uuid, boolean, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_utility_service(uuid, jsonb),
  public.submit_utility_readings(uuid, date, jsonb), public.review_utility_bill(uuid, boolean, text, date) TO authenticated;

CREATE FUNCTION private.protect_utility_agreement_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.owner_id, NEW.tenant_id, NEW.property_id, NEW.unit_id) IS DISTINCT FROM
    (OLD.owner_id, OLD.tenant_id, OLD.property_id, OLD.unit_id)
    AND EXISTS (SELECT 1 FROM public.utility_services WHERE agreement_id = OLD.id) THEN
    RAISE EXCEPTION 'Для смены сторон или объекта с коммунальным учётом создайте новый договор' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_utility_agreement_identity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_utility_agreement_identity BEFORE UPDATE OF owner_id, tenant_id, property_id, unit_id
  ON public.lease_agreements FOR EACH ROW EXECUTE FUNCTION private.protect_utility_agreement_identity();

ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_valid;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_valid CHECK (kind IN (
  'request_created', 'request_comment', 'request_status', 'agreement_created', 'agreement_status',
  'agreement_accepted', 'agreement_expiring', 'payment_status', 'payment_due', 'payment_overdue',
  'payment_reminder', 'payment_reported', 'payment_report_status', 'utility_submitted', 'utility_reviewed'
));

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('utility-reading-photos', 'utility-reading-photos', false, 8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']) ON CONFLICT (id) DO NOTHING;
CREATE POLICY utility_photos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'utility-reading-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND EXISTS (SELECT 1 FROM public.lease_agreements AS agreement
    WHERE agreement.id::text = (storage.foldername(name))[2] AND agreement.status = 'active'
    AND private.can_use_utilities(agreement.id))
);
CREATE POLICY utility_photos_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'utility-reading-photos' AND (
    (storage.foldername(name))[1] = (SELECT auth.uid())::text
    OR EXISTS (SELECT 1 FROM public.utility_bill_items AS item WHERE item.photo_path = objects.name)
  )
);
CREATE POLICY utility_photos_delete_unattached ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'utility-reading-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND NOT EXISTS (SELECT 1 FROM public.utility_bill_items AS item WHERE item.photo_path = objects.name)
);
