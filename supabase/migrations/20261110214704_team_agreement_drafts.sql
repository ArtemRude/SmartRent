SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.lease_agreements
  ADD COLUMN team_prepared boolean NOT NULL DEFAULT false;

CREATE FUNCTION private.create_team_agreement_draft(
  p_property_id uuid,
  p_tenant_id uuid,
  p_draft_id uuid,
  p_start_date date,
  p_end_date date,
  p_monthly_payment numeric,
  p_unit_id uuid DEFAULT NULL,
  p_payment_due_day integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_owner_id uuid;
  v_property_status text;
  v_tenant_name text;
  v_tenant_email text;
  v_target_tenant_id uuid;
  v_candidates uuid[];
  v_inserted_id uuid;
  v_same_terms boolean;
BEGIN
  SELECT p.owner_id INTO v_owner_id FROM public.properties p WHERE p.id = p_property_id;
  IF v_owner_id IS NULL OR NOT private.team_has_access(p_property_id, true) THEN
    RAISE EXCEPTION 'Черновик может создать собственник или управляющий объекта'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize with changes to the actual owner's team grants and recheck access.
  PERFORM pg_advisory_xact_lock(hashtextextended('team:' || v_owner_id::text, 0));
  SELECT p.status INTO v_property_status FROM public.properties p
    WHERE p.id = p_property_id AND p.owner_id = v_owner_id FOR SHARE;
  IF NOT FOUND OR NOT private.team_has_access(p_property_id, true) THEN
    RAISE EXCEPTION 'Нет доступа к созданию черновика по объекту' USING ERRCODE = '42501';
  END IF;
  IF v_property_status <> 'active' THEN
    RAISE EXCEPTION 'Восстановите объект из архива перед созданием договора' USING ERRCODE = '22023';
  END IF;

  IF p_draft_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL
    OR NOT isfinite(p_start_date) OR NOT isfinite(p_end_date) OR p_end_date < p_start_date
    OR p_monthly_payment IS NULL OR NOT (p_monthly_payment >= 0 AND p_monthly_payment < 'Infinity'::numeric)
    OR (p_payment_due_day IS NOT NULL AND p_payment_due_day NOT BETWEEN 1 AND 31) THEN
    RAISE EXCEPTION 'Проверьте даты договора, сумму аренды и день оплаты' USING ERRCODE = '22023';
  END IF;

  IF p_unit_id IS NOT NULL THEN
    PERFORM 1 FROM public.units u WHERE u.id = p_unit_id AND u.property_id = p_property_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Выберите помещение этого объекта' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT t.name, lower(btrim(t.email)) INTO v_tenant_name, v_tenant_email
    FROM public.tenants t WHERE t.id = p_tenant_id AND t.owner_id = v_actor_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Выберите арендатора из своего списка' USING ERRCODE = '42501';
  END IF;
  IF v_actor_id <> v_owner_id AND v_tenant_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Укажите корректный email в карточке арендатора' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.lease_agreements a WHERE a.id = p_draft_id) THEN
    IF v_actor_id = v_owner_id THEN
      v_target_tenant_id := p_tenant_id;
    ELSE
      SELECT array_agg(c.id) INTO v_candidates FROM (
        SELECT t.id FROM public.tenants t
        WHERE t.owner_id = v_owner_id AND lower(btrim(t.email)) = v_tenant_email
        ORDER BY t.id LIMIT 2 FOR SHARE
      ) c;
      IF cardinality(v_candidates) > 1 THEN
        RAISE EXCEPTION 'Не удалось однозначно подобрать арендатора. Обратитесь к собственнику.'
          USING ERRCODE = '22023';
      END IF;
      v_target_tenant_id := v_candidates[1];
      IF v_target_tenant_id IS NULL THEN
        INSERT INTO public.tenants (owner_id, name, email)
          VALUES (v_owner_id, v_tenant_name, v_tenant_email)
          RETURNING id INTO v_target_tenant_id;
      END IF;
    END IF;

    INSERT INTO public.lease_agreements (
      id, owner_id, property_id, unit_id, tenant_id, start_date, end_date,
      monthly_payment, payment_due_day, status, team_prepared
    ) VALUES (
      p_draft_id, v_owner_id, p_property_id, p_unit_id, v_target_tenant_id, p_start_date, p_end_date,
      p_monthly_payment, p_payment_due_day, 'draft', v_actor_id <> v_owner_id
    ) ON CONFLICT (id) DO NOTHING RETURNING id INTO v_inserted_id;
    IF FOUND THEN
      RETURN v_inserted_id;
    END IF;
  END IF;

  -- The existing status trigger records the caller who initially created the draft.
  -- The same terms can be retried even after the owner has advanced the status.
  SELECT ROW(a.start_date, a.end_date, a.monthly_payment, a.unit_id, a.payment_due_day)
      IS NOT DISTINCT FROM ROW(p_start_date, p_end_date, p_monthly_payment, p_unit_id, p_payment_due_day)
    INTO v_same_terms
    FROM public.lease_agreements a
    JOIN public.tenants t ON t.id = a.tenant_id AND t.owner_id = a.owner_id
    JOIN public.agreement_status_events e ON e.agreement_id = a.id
      AND e.from_status IS NULL AND e.to_status = 'draft' AND e.changed_by = v_actor_id
    WHERE a.id = p_draft_id AND a.owner_id = v_owner_id AND a.property_id = p_property_id
      AND CASE WHEN v_actor_id = v_owner_id THEN t.id = p_tenant_id
        ELSE lower(btrim(t.email)) = v_tenant_email END;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Не удалось создать черновик с этим идентификатором' USING ERRCODE = '22023';
  END IF;
  IF v_same_terms THEN
    RETURN p_draft_id;
  END IF;
  RAISE EXCEPTION 'Черновик уже создан или изменён. Проверьте его условия в разделе «Договоры».'
    USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.create_team_agreement_draft(
  p_property_id uuid,
  p_tenant_id uuid,
  p_draft_id uuid,
  p_start_date date,
  p_end_date date,
  p_monthly_payment numeric,
  p_unit_id uuid DEFAULT NULL,
  p_payment_due_day integer DEFAULT NULL
) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.create_team_agreement_draft(
    p_property_id, p_tenant_id, p_draft_id, p_start_date, p_end_date,
    p_monthly_payment, p_unit_id, p_payment_due_day
  );
$$;

REVOKE ALL ON FUNCTION private.create_team_agreement_draft(uuid,uuid,uuid,date,date,numeric,uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_team_agreement_draft(uuid,uuid,uuid,date,date,numeric,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.create_team_agreement_draft(uuid,uuid,uuid,date,date,numeric,uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_team_agreement_draft(uuid,uuid,uuid,date,date,numeric,uuid,integer) TO authenticated, service_role;

-- A manager must not learn the owner's matching contact name from a draft they created.
-- The owner can see all drafts. Existing owner-created summaries remain visible to staff.
CREATE OR REPLACE FUNCTION private.team_workspace(p_property_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_property public.properties; v_result jsonb;
BEGIN
  IF NOT private.team_has_access(p_property_id,false) THEN RAISE EXCEPTION 'Доступ к объекту отозван или не предоставлен' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_property FROM public.properties WHERE id=p_property_id;
  WITH requests AS (
    SELECT r.id,r.title,r.description,r.category,r.status,r.created_at,
      coalesce(t.name,'Арендатор') AS tenant_name,u.name AS unit_name
    FROM public.requests r LEFT JOIN public.tenants t ON t.id=r.tenant_id AND t.owner_id=v_property.owner_id
      LEFT JOIN public.units u ON u.id=r.unit_id AND u.property_id=p_property_id
    WHERE r.property_id=p_property_id AND r.owner_id=v_property.owner_id ORDER BY r.created_at DESC,r.id DESC LIMIT 200
  ), comments AS (
    SELECT c.id,c.request_id,coalesce(nullif(u.name,''),'Пользователь') AS user_name,c.text,c.created_at
    FROM public.comments c JOIN requests r ON r.id=c.request_id LEFT JOIN public.profiles u ON u.id=c.user_id
    ORDER BY c.created_at DESC,c.id DESC LIMIT 500
  ), notes AS (
    SELECT a.id,a.detail->>'text' AS text,coalesce(nullif(u.name,''),'Пользователь') AS actor_name,a.created_at
    FROM public.team_activity a LEFT JOIN public.profiles u ON u.id=a.actor_id
    WHERE a.owner_id=v_property.owner_id AND a.property_id=p_property_id AND a.action='property_note' ORDER BY a.created_at DESC,a.id DESC LIMIT 50
  )
  SELECT jsonb_build_object(
    'property',jsonb_build_object('id',v_property.id,'name',v_property.name,'address',v_property.address,'description',v_property.description,'status',v_property.status,
      'owner_id',v_property.owner_id,'owner_name',(SELECT coalesce(nullif(name,''),'Собственник') FROM public.profiles WHERE id=v_property.owner_id),
      'role',CASE WHEN v_property.owner_id=v_uid THEN 'owner' ELSE (SELECT role FROM public.team_memberships WHERE owner_id=v_property.owner_id AND user_id=v_uid AND status='active') END,
      'responsible_name',(SELECT coalesce(nullif(btrim(u.name),''),CASE WHEN v_property.owner_id=v_uid THEN m.email END,'Управляющий') FROM public.team_property_responsibles r
        JOIN public.team_memberships m ON m.id=r.membership_id AND m.owner_id=v_property.owner_id AND m.status='active' AND m.role='manager' AND m.user_id IS NOT NULL
        JOIN public.team_property_access g ON g.membership_id=m.id AND g.property_id=p_property_id LEFT JOIN public.profiles u ON u.id=m.user_id WHERE r.property_id=p_property_id)),
    'units',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'area',area,'status',status) ORDER BY name,id) FROM public.units WHERE property_id=p_property_id),'[]'),
    'agreements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'tenant_name',t.name,'unit_name',u.name,'start_date',a.start_date,'end_date',a.end_date,
      'monthly_payment',private.agreement_rent_at(a.id,CURRENT_DATE,a.monthly_payment),'status',a.status) ORDER BY a.end_date,a.id)
      FROM public.lease_agreements a JOIN public.tenants t ON t.id=a.tenant_id AND t.owner_id=v_property.owner_id
      LEFT JOIN public.units u ON u.id=a.unit_id AND u.property_id=p_property_id
      WHERE a.property_id=p_property_id AND a.owner_id=v_property.owner_id
        AND (a.status <> 'draft' OR v_property.owner_id = v_uid OR NOT a.team_prepared)),'[]'),
    'requests',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at DESC,id DESC) FROM requests r),'[]'),
    'comments',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY created_at,id) FROM comments c),'[]'),
    'notes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY created_at DESC,id DESC) FROM notes n),'[]'),
    'requests_truncated',(SELECT count(*)>200 FROM public.requests WHERE property_id=p_property_id AND owner_id=v_property.owner_id),
    'comments_truncated',(SELECT count(*)>500 FROM public.comments c JOIN requests r ON r.id=c.request_id),
    'notes_truncated',(SELECT count(*)>50 FROM public.team_activity WHERE owner_id=v_property.owner_id AND property_id=p_property_id AND action='property_note')
  ) INTO v_result;
  RETURN v_result;
END;
$$;
