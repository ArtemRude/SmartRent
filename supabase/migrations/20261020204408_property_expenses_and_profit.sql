SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE public.property_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  category text NOT NULL CHECK (category IN ('repair','maintenance','tax','insurance','management','other')),
  planned_date date NOT NULL CHECK (planned_date BETWEEN '2000-01-01' AND '2100-12-31'),
  planned_amount numeric(14,2) NOT NULL CHECK (planned_amount > 0 AND planned_amount < 1000000000),
  status text NOT NULL CHECK (status IN ('planned','paid','cancelled')),
  paid_date date,
  paid_amount numeric(14,2),
  receipt_file text,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'paid' AND paid_date IS NOT NULL AND paid_amount IS NOT NULL AND paid_amount > 0 AND paid_amount < 1000000000)
    OR (status <> 'paid' AND paid_date IS NULL AND paid_amount IS NULL AND receipt_file IS NULL))
);
CREATE INDEX property_expenses_property_plan_idx ON public.property_expenses(property_id,planned_date,id);
CREATE INDEX property_expenses_property_paid_idx ON public.property_expenses(property_id,paid_date,id) WHERE status='paid';
CREATE INDEX property_expenses_receipt_idx ON public.property_expenses(receipt_file) WHERE receipt_file IS NOT NULL;
CREATE TABLE public.property_expense_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.property_expenses(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text CHECK (char_length(reason) <= 2000),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX property_expense_events_expense_created_idx ON public.property_expense_events(expense_id,created_at,id);
CREATE INDEX property_expense_events_actor_idx ON public.property_expense_events(actor_id);
CREATE INDEX property_expense_events_receipt_idx ON public.property_expense_events((snapshot->>'receipt_file')) WHERE snapshot->>'receipt_file' IS NOT NULL;
ALTER TABLE public.property_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_expense_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_expenses,public.property_expense_events FROM anon,authenticated;
GRANT SELECT ON public.property_expenses,public.property_expense_events TO authenticated;
GRANT ALL ON public.property_expenses,public.property_expense_events TO service_role;

CREATE FUNCTION private.manage_property_finances(p_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.properties p WHERE p.id=p_property_id AND (
      private.has_role(auth.uid(),'admin'::public.app_role)
      OR (p.owner_id=auth.uid() AND private.has_role(auth.uid(),'owner'::public.app_role))
    )
  );
$$;
REVOKE ALL ON FUNCTION private.manage_property_finances(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.manage_property_finances(uuid) TO authenticated,service_role;
CREATE POLICY expenses_manager_read ON public.property_expenses FOR SELECT TO authenticated
USING (private.manage_property_finances(property_id));
CREATE POLICY expense_events_manager_read ON public.property_expense_events FOR SELECT TO authenticated
USING (EXISTS(SELECT 1 FROM public.property_expenses e WHERE e.id=expense_id));

CREATE FUNCTION private.save_property_expense(p_property_id uuid,p_expense_id uuid,p_values jsonb,p_expected_revision integer,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  e public.property_expenses%ROWTYPE;
  target_status text := p_values->>'status';
  planned numeric;
  actual numeric;
  plan_date date;
  actual_date date;
  receipt text := NULLIF(p_values->>'receipt_file','');
BEGIN
  IF NOT private.manage_property_finances(p_property_id) THEN
    RAISE EXCEPTION 'Нет доступа к расходам объекта' USING ERRCODE='42501';
  END IF;
  -- Lock the property before the expense, consistently across all writers.
  PERFORM 1 FROM public.properties WHERE id=p_property_id FOR UPDATE;
  IF NOT private.manage_property_finances(p_property_id) THEN
    RAISE EXCEPTION 'Нет доступа к расходам объекта' USING ERRCODE='42501';
  END IF;
  IF p_expense_id IS NOT NULL THEN
    SELECT * INTO e FROM public.property_expenses WHERE id=p_expense_id AND property_id=p_property_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Расход не найден в этом объекте' USING ERRCODE='42501'; END IF;
    IF e.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Расход изменился. Обновите данные и повторите действие' USING ERRCODE='40001'; END IF;
    IF e.status='cancelled' THEN RAISE EXCEPTION 'Отменённый расход нельзя изменить' USING ERRCODE='23514'; END IF;
  ELSIF p_expected_revision IS NOT NULL THEN
    RAISE EXCEPTION 'Расход изменился. Обновите данные и повторите действие' USING ERRCODE='40001';
  END IF;
  IF target_status IS NULL OR target_status NOT IN ('planned','paid','cancelled') OR (e.id IS NULL AND target_status='cancelled') THEN
    RAISE EXCEPTION 'Выберите состояние расхода' USING ERRCODE='23514';
  END IF;
  IF e.status='paid' AND (target_status<>'paid' OR NULLIF(btrim(p_reason),'') IS NULL) THEN
    RAISE EXCEPTION 'Для исправления оплаченного расхода укажите причину; отмена оплаты недоступна' USING ERRCODE='23514';
  END IF;
  IF e.id IS NOT NULL AND (target_status='paid' OR e.status='paid') AND (
    p_values->>'planned_date' IS DISTINCT FROM e.planned_date::text
    OR (p_values->>'planned_amount')::numeric IS DISTINCT FROM e.planned_amount
  ) THEN
    RAISE EXCEPTION 'При оплате исходный план сохраняется. Укажите фактические сумму и дату отдельно' USING ERRCODE='23514';
  END IF;
  IF COALESCE(char_length(btrim(p_values->>'title')),0) NOT BETWEEN 1 AND 200
    OR p_values->>'category' IS NULL OR p_values->>'category' NOT IN ('repair','maintenance','tax','insurance','management','other')
    OR char_length(COALESCE(p_values->>'note',''))>2000 OR char_length(p_reason)>2000 THEN
    RAISE EXCEPTION 'Проверьте название, категорию и описание расхода' USING ERRCODE='23514';
  END IF;
  IF COALESCE(p_values->>'planned_amount','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Укажите плановую сумму с точностью до копеек' USING ERRCODE='23514';
  END IF;
  planned := (p_values->>'planned_amount')::numeric;
  plan_date := (p_values->>'planned_date')::date;
  IF planned<=0 OR plan_date IS NULL OR plan_date NOT BETWEEN '2000-01-01' AND '2100-12-31' THEN
    RAISE EXCEPTION 'Проверьте плановую сумму и дату' USING ERRCODE='23514';
  END IF;
  IF target_status='paid' THEN
    IF COALESCE(p_values->>'paid_amount','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Укажите оплаченную сумму с точностью до копеек' USING ERRCODE='23514';
    END IF;
    actual := (p_values->>'paid_amount')::numeric;
    actual_date := (p_values->>'paid_date')::date;
    IF actual<=0 OR actual_date IS NULL OR actual_date<'2000-01-01' OR actual_date>CURRENT_DATE THEN
      RAISE EXCEPTION 'Проверьте сумму и дату оплаты: будущая оплата недопустима' USING ERRCODE='23514';
    END IF;
  ELSIF p_values->>'paid_amount' IS NOT NULL OR p_values->>'paid_date' IS NOT NULL OR receipt IS NOT NULL THEN
    RAISE EXCEPTION 'Данные оплаты доступны только оплаченному расходу' USING ERRCODE='23514';
  END IF;
  IF receipt IS NOT NULL AND NOT (
    (receipt IS NOT DISTINCT FROM e.receipt_file AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='expense-receipts' AND o.name=receipt))
    OR (receipt LIKE auth.uid()::text || '/' || p_property_id::text || '/%'
      AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='expense-receipts' AND o.name=receipt AND o.owner_id=auth.uid()::text))
  ) THEN RAISE EXCEPTION 'Приложите чек, загруженный для этого объекта' USING ERRCODE='42501'; END IF;
  IF e.id IS NULL THEN
    INSERT INTO public.property_expenses(property_id,title,category,planned_date,planned_amount,status,paid_date,paid_amount,receipt_file,note)
    VALUES(p_property_id,btrim(p_values->>'title'),p_values->>'category',plan_date,planned,target_status,actual_date,actual,receipt,COALESCE(p_values->>'note','')) RETURNING * INTO e;
  ELSE
    UPDATE public.property_expenses SET title=btrim(p_values->>'title'),category=p_values->>'category',planned_date=plan_date,planned_amount=planned,
      status=target_status,paid_date=actual_date,paid_amount=actual,receipt_file=receipt,note=COALESCE(p_values->>'note',''),revision=revision+1,updated_at=clock_timestamp()
    WHERE id=e.id RETURNING * INTO e;
  END IF;
  INSERT INTO public.property_expense_events(expense_id,actor_id,reason,snapshot)
  VALUES(e.id,auth.uid(),NULLIF(btrim(p_reason),''),to_jsonb(e));
  RETURN e.id;
END;
$$;
REVOKE ALL ON FUNCTION private.save_property_expense(uuid,uuid,jsonb,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.save_property_expense(uuid,uuid,jsonb,integer,text) TO authenticated,service_role;
CREATE FUNCTION public.save_property_expense(p_property_id uuid,p_values jsonb,p_expense_id uuid DEFAULT NULL,p_expected_revision integer DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.save_property_expense(p_property_id,p_expense_id,p_values,p_expected_revision,p_reason);
$$;
REVOKE ALL ON FUNCTION public.save_property_expense(uuid,jsonb,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_property_expense(uuid,jsonb,uuid,integer,text) TO authenticated,service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('expense-receipts','expense-receipts',false,10485760,ARRAY['application/pdf','image/jpeg','image/png','image/webp']);
CREATE POLICY expense_receipts_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (
 bucket_id='expense-receipts' AND (storage.foldername(objects.name))[1]=(SELECT auth.uid())::text
 AND EXISTS(SELECT 1 FROM public.properties p WHERE p.id::text=(storage.foldername(objects.name))[2] AND private.manage_property_finances(p.id))
);
CREATE POLICY expense_receipts_read ON storage.objects FOR SELECT TO authenticated USING (
 bucket_id='expense-receipts' AND (
  ((storage.foldername(objects.name))[1]=(SELECT auth.uid())::text AND EXISTS(SELECT 1 FROM public.properties p WHERE p.id::text=(storage.foldername(objects.name))[2] AND private.manage_property_finances(p.id)))
  OR EXISTS(SELECT 1 FROM public.property_expenses e WHERE e.receipt_file=objects.name)
  OR EXISTS(SELECT 1 FROM public.property_expense_events e WHERE e.snapshot->>'receipt_file'=objects.name)
 )
);
CREATE POLICY expense_receipts_delete_unattached ON storage.objects FOR DELETE TO authenticated USING (
 bucket_id='expense-receipts' AND (storage.foldername(objects.name))[1]=(SELECT auth.uid())::text
 AND EXISTS(SELECT 1 FROM public.properties p WHERE p.id::text=(storage.foldername(objects.name))[2] AND private.manage_property_finances(p.id))
 AND NOT EXISTS(SELECT 1 FROM public.property_expenses e WHERE e.receipt_file=objects.name)
 AND NOT EXISTS(SELECT 1 FROM public.property_expense_events e WHERE e.snapshot->>'receipt_file'=objects.name)
);
