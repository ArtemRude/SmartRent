SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION private.set_team_responsible(
  p_property_id uuid, p_membership_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_owner_id uuid;
  v_name text;
BEGIN
  SELECT p.owner_id INTO v_owner_id FROM public.properties p WHERE p.id = p_property_id;
  IF v_owner_id IS NULL OR NOT private.team_has_access(p_property_id, true) THEN
    RAISE EXCEPTION 'Назначить ответственного может собственник или управляющий объекта'
      USING ERRCODE = '42501';
  END IF;

  -- Access edits, revocation and assignment use the same owner's team lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('team:' || v_owner_id::text, 0));
  PERFORM 1 FROM public.properties p
    WHERE p.id = p_property_id AND p.owner_id = v_owner_id FOR SHARE;
  IF NOT FOUND OR NOT private.team_has_access(p_property_id, true) THEN
    RAISE EXCEPTION 'Нет доступа к назначению ответственного по объекту'
      USING ERRCODE = '42501';
  END IF;

  IF p_membership_id IS NULL THEN
    DELETE FROM public.team_property_responsibles WHERE property_id = p_property_id;
  ELSE
    SELECT coalesce(nullif(btrim(u.name), ''), 'Управляющий') INTO v_name
      FROM public.team_memberships m
      JOIN public.team_property_access g ON g.membership_id = m.id AND g.property_id = p_property_id
      LEFT JOIN public.profiles u ON u.id = m.user_id
      WHERE m.id = p_membership_id AND m.owner_id = v_owner_id AND m.status = 'active'
        AND m.role = 'manager' AND m.user_id IS NOT NULL
      FOR SHARE OF m;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Выберите действующего управляющего с доступом к объекту'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.team_property_responsibles AS assignment (property_id, membership_id)
      VALUES (p_property_id, p_membership_id)
      ON CONFLICT (property_id) DO UPDATE SET membership_id = excluded.membership_id
      WHERE assignment.membership_id IS DISTINCT FROM excluded.membership_id;
  END IF;

  IF NOT FOUND THEN
    RETURN p_property_id;
  END IF;

  INSERT INTO public.team_activity (owner_id, actor_id, property_id, membership_id, action, detail)
    VALUES (v_owner_id, v_actor_id, p_property_id, p_membership_id,
      'responsible_changed', jsonb_build_object('name', v_name));
  RETURN p_property_id;
END;
$$;

-- A shared property shows the assignee's display name without exposing their email.
CREATE OR REPLACE FUNCTION private.team_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
  WITH work AS (
    SELECT p.id,p.name,p.address,p.status,p.owner_id,coalesce(nullif(o.name,''),'Собственник') AS owner_name,
      m.id AS membership_id,CASE WHEN p.owner_id=v_uid THEN 'owner' ELSE m.role END AS role,
      (SELECT coalesce(nullif(btrim(rp.name),''),CASE WHEN p.owner_id=v_uid THEN rm.email END,'Управляющий') FROM public.team_property_responsibles r
        JOIN public.team_memberships rm ON rm.id=r.membership_id AND rm.owner_id=p.owner_id AND rm.status='active' AND rm.role='manager' AND rm.user_id IS NOT NULL
        JOIN public.team_property_access rg ON rg.membership_id=rm.id AND rg.property_id=p.id
        LEFT JOIN public.profiles rp ON rp.id=rm.user_id WHERE r.property_id=p.id) AS responsible_name,
      (SELECT count(*) FROM public.units u WHERE u.property_id=p.id) AS unit_count,
      (SELECT count(*) FROM public.lease_agreements a WHERE a.property_id=p.id AND a.owner_id=p.owner_id AND a.status='active') AS active_agreements,
      (SELECT count(*) FROM public.requests r WHERE r.property_id=p.id AND r.owner_id=p.owner_id AND r.status<>'closed') AS open_requests
    FROM public.properties p LEFT JOIN public.profiles o ON o.id=p.owner_id
    LEFT JOIN public.team_memberships m ON m.owner_id=p.owner_id AND m.user_id=v_uid AND m.status='active'
      AND EXISTS(SELECT 1 FROM public.team_property_access g WHERE g.membership_id=m.id AND g.property_id=p.id)
    WHERE p.owner_id=v_uid OR m.id IS NOT NULL
  ), members AS (
    SELECT m.id,m.owner_id,coalesce(nullif(o.name,''),'Собственник') AS owner_name,m.email,
      coalesce(nullif(u.name,''),m.email) AS name,m.user_id,m.role,m.status,m.expires_at,m.revision,m.created_at,m.joined_at,
      coalesce((SELECT jsonb_agg(g.property_id ORDER BY g.property_id) FROM public.team_property_access g
        JOIN public.properties p ON p.id=g.property_id AND p.owner_id=m.owner_id
        WHERE g.membership_id=m.id AND (m.owner_id=v_uid OR m.status='active')),'[]') AS property_ids
    FROM public.team_memberships m LEFT JOIN public.profiles o ON o.id=m.owner_id LEFT JOIN public.profiles u ON u.id=m.user_id
    WHERE m.owner_id=v_uid OR m.user_id=v_uid
  ), events AS (
    SELECT a.id,a.owner_id,a.property_id,a.membership_id,coalesce(nullif(u.name,''),'Пользователь') AS actor_name,a.action,a.detail,a.created_at
    FROM public.team_activity a LEFT JOIN public.profiles u ON u.id=a.actor_id WHERE a.owner_id=v_uid ORDER BY a.created_at DESC,a.id DESC LIMIT 100
  )
  SELECT jsonb_build_object(
    'properties',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'status',status) ORDER BY name,id) FROM public.properties WHERE owner_id=v_uid),'[]'),
    'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY created_at DESC,id) FROM members m),'[]'),
    'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('property_id',r.property_id,'membership_id',r.membership_id)) FROM public.team_property_responsibles r
       JOIN public.properties p ON p.id=r.property_id AND p.owner_id=v_uid
       JOIN public.team_memberships m ON m.id=r.membership_id AND m.owner_id=p.owner_id AND m.status='active' AND m.role='manager' AND m.user_id IS NOT NULL
       JOIN public.team_property_access g ON g.property_id=p.id AND g.membership_id=m.id),'[]'),
    'workspaces',coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY name,id) FROM work w),'[]'),
    'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at DESC,id DESC) FROM events e),'[]'),
    'events_truncated',(SELECT count(*)>100 FROM public.team_activity WHERE owner_id=v_uid)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

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
      LEFT JOIN public.units u ON u.id=a.unit_id AND u.property_id=p_property_id WHERE a.property_id=p_property_id AND a.owner_id=v_property.owner_id),'[]'),
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

CREATE FUNCTION private.team_responsible_assignment(p_property_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN private.team_has_access(p_property_id, true) THEN (
    WITH candidates AS (
      SELECT m.id, coalesce(nullif(btrim(u.name), ''), 'Управляющий') AS name
      FROM public.properties p
      JOIN public.team_property_access g ON g.property_id = p.id
      JOIN public.team_memberships m ON m.id = g.membership_id AND m.owner_id = p.owner_id
      LEFT JOIN public.profiles u ON u.id = m.user_id
      WHERE p.id = p_property_id AND m.status = 'active' AND m.role = 'manager'
        AND m.user_id IS NOT NULL
    )
    SELECT jsonb_build_object(
      'membership_id', (
        SELECT r.membership_id FROM public.team_property_responsibles r
        JOIN candidates c ON c.id = r.membership_id WHERE r.property_id = p_property_id
      ),
      'candidates', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name, c.id) FROM candidates c), '[]'::jsonb)
    )
  ) END;
$$;

REVOKE ALL ON FUNCTION private.team_responsible_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.team_responsible_assignment(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.team_workspace(p_property_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.team_workspace(p_property_id) || jsonb_build_object(
    'responsible_assignment', private.team_responsible_assignment(p_property_id)
  );
$$;
