SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- A calendar is a projection of existing records, never a second schedule.
-- Raw team/recruitment/repair tables remain private. Each branch checks its own
-- capability: operational membership does not confer financial/document access.
CREATE FUNCTION private.rental_calendar(
  p_from date, p_to date, p_timezone text DEFAULT 'Europe/Moscow',
  p_property_id uuid DEFAULT NULL, p_responsible_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  administrator boolean;
  response jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
    OR p_to <= p_from OR p_to - p_from > 62
    OR p_timezone IS NULL OR length(p_timezone) > 100
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Выберите период до 62 дней и корректный часовой пояс' USING ERRCODE = '22023';
  END IF;
  administrator := private.has_role(caller, 'admin');

  WITH property_scope AS MATERIALIZED (
    SELECT p.id, p.owner_id, p.name,
      (p.owner_id = caller OR administrator) AS owner_access,
      member.role AS team_role,
      EXISTS (
        SELECT 1 FROM public.lease_agreements a JOIN public.tenants t ON t.id = a.tenant_id
        WHERE a.property_id = p.id AND a.owner_id = p.owner_id AND a.status IN ('active', 'completed')
          AND t.owner_id = p.owner_id AND t.user_id = caller
      ) OR EXISTS (
        SELECT 1 FROM public.repair_jobs j JOIN public.requests r ON r.id = j.request_id
        JOIN public.tenants t ON t.id = r.tenant_id
        WHERE j.property_id = p.id AND j.owner_id = p.owner_id AND r.owner_id = p.owner_id
          AND t.owner_id = p.owner_id AND t.user_id = caller AND j.published_at IS NOT NULL
      ) AS tenant_access,
      COALESCE(responsible.user_id, p.owner_id) AS assigned_id,
      CASE WHEN responsible.user_id IS NOT NULL
        THEN COALESCE(NULLIF(responsible_profile.name, ''), 'Управляющий')
        ELSE COALESCE(NULLIF(owner_profile.name, ''), 'Собственник') END AS assigned_name,
      candidate.title AS public_name
    FROM public.properties p
    LEFT JOIN public.profiles owner_profile ON owner_profile.id = p.owner_id
    LEFT JOIN public.team_memberships member ON member.owner_id = p.owner_id
      AND member.user_id = caller AND member.status = 'active'
      AND EXISTS (SELECT 1 FROM public.team_property_access g
        WHERE g.membership_id = member.id AND g.property_id = p.id)
    LEFT JOIN public.team_property_responsibles assignment ON assignment.property_id = p.id
    LEFT JOIN public.team_memberships responsible ON responsible.id = assignment.membership_id
      AND responsible.owner_id = p.owner_id AND responsible.status = 'active'
      AND responsible.role = 'manager' AND responsible.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.team_property_access g
        WHERE g.membership_id = responsible.id AND g.property_id = p.id)
    LEFT JOIN public.profiles responsible_profile ON responsible_profile.id = responsible.user_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(a.offer->>'title', ''), 'Объект по объявлению') AS title
      FROM public.rental_applications a JOIN public.property_listings l ON l.id = a.listing_id
      WHERE l.property_id = p.id AND a.applicant_id = caller AND a.status = 'showing'
      ORDER BY a.created_at, a.id LIMIT 1
    ) candidate ON true
  ), visible_properties AS MATERIALIZED (
    SELECT p.*,
      CASE WHEN owner_access OR team_role IS NOT NULL OR tenant_access THEN name ELSE public_name END AS label,
      CASE WHEN owner_access OR team_role IS NOT NULL THEN assigned_id END AS responsible_id,
      CASE WHEN owner_access OR team_role IS NOT NULL THEN assigned_name
        WHEN tenant_access THEN 'Собственник' ELSE 'Команда объекта' END AS responsible_name
    FROM property_scope p
    WHERE owner_access OR team_role IS NOT NULL OR tenant_access OR public_name IS NOT NULL
  ), raw_events AS (
    SELECT 'payment:' || c.id AS id, 'payment'::text AS kind, c.due_date AS date,
      NULL::timestamptz AS starts_at, p.id AS property_id,
      CASE WHEN c.charge_type = 'utilities' THEN 'Коммунальные услуги' ELSE 'Аренда' END AS title,
      CASE WHEN c.paid_at IS NOT NULL THEN 'paid' WHEN COALESCE(c.paid_amount, 0) > 0 THEN 'partial'
        WHEN c.due_date < (now() AT TIME ZONE p_timezone)::date THEN 'overdue' ELSE 'pending' END AS status,
      p.responsible_id, p.responsible_name,
      c.amount + COALESCE(c.adjustment_amount, 0) AS amount,
      CASE WHEN c.paid_at IS NOT NULL
        THEN c.amount + COALESCE(c.adjustment_amount, 0) ELSE COALESCE(c.paid_amount, 0) END AS paid_amount,
      c.id AS source_id, a.id AS agreement_id, NULL::uuid AS request_id,
      CASE WHEN p.owner_access THEN 'owner' ELSE 'tenant' END AS access, false AS estimated
    FROM public.rent_charges c
    JOIN public.lease_agreements a ON a.id = c.agreement_id AND a.owner_id = c.owner_id AND a.tenant_id = c.tenant_id
    JOIN public.tenants t ON t.id = a.tenant_id AND t.owner_id = a.owner_id
    JOIN visible_properties p ON p.id = a.property_id AND p.owner_id = a.owner_id
    WHERE c.due_date >= p_from AND c.due_date < p_to
      AND (p.owner_access OR t.user_id = caller)

    UNION ALL
    SELECT 'showing:' || a.id, 'showing', (a.showing_at AT TIME ZONE p_timezone)::date,
      a.showing_at, p.id,
      CASE WHEN p.owner_access OR p.team_role = 'manager' THEN 'Показ: ' || a.name ELSE 'Показ объекта' END,
      a.status, p.responsible_id, p.responsible_name, NULL::numeric, NULL::numeric,
      a.id, NULL::uuid, NULL::uuid,
      CASE WHEN p.owner_access THEN 'owner' WHEN p.team_role = 'manager' THEN 'team' ELSE 'tenant' END, false
    FROM public.rental_applications a
    JOIN public.property_listings l ON l.id = a.listing_id
    JOIN visible_properties p ON p.id = l.property_id
    WHERE a.status = 'showing'
      AND a.showing_at >= (p_from::timestamp AT TIME ZONE p_timezone)
      AND a.showing_at < (p_to::timestamp AT TIME ZONE p_timezone)
      AND (p.owner_access OR p.team_role = 'manager' OR a.applicant_id = caller)

    UNION ALL
    SELECT k.kind || ':' || a.id, k.kind,
      COALESCE(h.inspection_date, CASE WHEN k.kind = 'move_in' THEN a.start_date ELSE a.end_date END),
      NULL::timestamptz, p.id,
      CASE WHEN k.kind = 'move_in' THEN 'Заселение' ELSE 'Выезд' END,
      COALESCE(h.status, 'planned'), p.responsible_id, p.responsible_name, NULL::numeric, NULL::numeric,
      a.id, a.id, NULL::uuid,
      CASE WHEN p.owner_access THEN 'owner' WHEN t.user_id = caller THEN 'tenant' ELSE 'team' END,
      h.id IS NULL
    FROM public.lease_agreements a
    JOIN public.tenants t ON t.id = a.tenant_id AND t.owner_id = a.owner_id
    JOIN visible_properties p ON p.id = a.property_id AND p.owner_id = a.owner_id
    CROSS JOIN (VALUES ('move_in'::text), ('move_out'::text)) k(kind)
    LEFT JOIN public.lease_handovers h ON h.agreement_id = a.id AND h.kind = k.kind
      AND (p.owner_access OR (t.user_id = caller AND h.status <> 'draft'))
    WHERE a.status IN ('active', 'completed')
      AND (p.owner_access OR p.team_role IS NOT NULL OR t.user_id = caller)
      AND COALESCE(h.inspection_date, CASE WHEN k.kind = 'move_in' THEN a.start_date ELSE a.end_date END) >= p_from
      AND COALESCE(h.inspection_date, CASE WHEN k.kind = 'move_in' THEN a.start_date ELSE a.end_date END) < p_to

    UNION ALL
    SELECT 'repair:' || j.id, 'repair', j.due_date, NULL::timestamptz, p.id,
      j.title, j.status, p.responsible_id, p.responsible_name, NULL::numeric, NULL::numeric,
      j.id, NULL::uuid, j.request_id,
      CASE WHEN p.owner_access THEN 'owner' WHEN p.team_role IS NOT NULL THEN 'team' ELSE 'tenant' END, false
    FROM public.repair_jobs j JOIN visible_properties p ON p.id = j.property_id AND p.owner_id = j.owner_id
    WHERE j.due_date >= p_from AND j.due_date < p_to AND j.status <> 'cancelled'
      AND private.repair_job_access(j.id, false)
  ), filtered AS MATERIALIZED (
    SELECT * FROM raw_events e
    WHERE (p_property_id IS NULL OR e.property_id = p_property_id)
      AND (p_responsible_id IS NULL OR e.responsible_id = p_responsible_id
        OR (p_responsible_id = '00000000-0000-0000-0000-000000000000' AND e.responsible_id IS NULL))
    ORDER BY date, starts_at NULLS LAST, kind, id LIMIT 1001
  ), shown AS (SELECT * FROM filtered ORDER BY date, starts_at NULLS LAST, kind, id LIMIT 1000)
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', p_timezone,
    'properties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.label, 'responsible_id', p.responsible_id,
      'responsible_name', p.responsible_name) ORDER BY p.label, p.id) FROM visible_properties p), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY date, starts_at NULLS LAST, kind, id) FROM shown e), '[]'::jsonb),
    'truncated', (SELECT count(*) > 1000 FROM filtered)
  ) INTO response;
  RETURN response;
END;
$$;

CREATE FUNCTION public.rental_calendar(
  p_from date, p_to date, p_timezone text DEFAULT 'Europe/Moscow',
  p_property_id uuid DEFAULT NULL, p_responsible_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.rental_calendar(p_from, p_to, p_timezone, p_property_id, p_responsible_id);
$$;
REVOKE ALL ON FUNCTION private.rental_calendar(date,date,text,uuid,uuid), public.rental_calendar(date,date,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rental_calendar(date,date,text,uuid,uuid), public.rental_calendar(date,date,text,uuid,uuid) TO authenticated, service_role;

-- Resolve the selected showing directly, without the overview's last-200 cap.
CREATE FUNCTION private.rental_calendar_application(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  applicant uuid;
  property uuid;
  workspace_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE = '42501'; END IF;
  SELECT a.applicant_id, l.property_id INTO applicant, property
    FROM public.rental_applications a JOIN public.property_listings l ON l.id = a.listing_id WHERE a.id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  workspace_role := private.hub_role(property);
  IF COALESCE(workspace_role, '') NOT IN ('owner', 'manager') AND applicant <> auth.uid() THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'application', private.application_snapshot(p_id, COALESCE(workspace_role, '') IN ('owner', 'manager')),
    'operator', COALESCE(workspace_role, '') IN ('owner', 'manager'),
    'owner', workspace_role IS NOT DISTINCT FROM 'owner');
END;
$$;
CREATE FUNCTION public.rental_calendar_application(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.rental_calendar_application(p_id);
$$;
REVOKE ALL ON FUNCTION private.rental_calendar_application(uuid), public.rental_calendar_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rental_calendar_application(uuid), public.rental_calendar_application(uuid) TO authenticated, service_role;


-- Exact authorized repair context, preserving the overview tenant redaction.
CREATE FUNCTION private.rental_calendar_repair(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE='42501'; END IF;
 WITH props AS (
  SELECT p.id,p.owner_id,p.name,p.address,private.repair_property_role(p.id) AS role FROM public.properties p WHERE private.repair_property_role(p.id) IS NOT NULL
 ), jobs AS (
  SELECT j.*,p.name AS property_name,p.role, r.title AS request_title FROM public.repair_jobs j JOIN props p ON p.id=j.property_id LEFT JOIN public.requests r ON r.id=j.request_id
  WHERE j.id=p_id AND private.repair_job_access(j.id,false) ORDER BY j.created_at DESC,j.id DESC LIMIT 500
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
  'jobs_truncated',false,
  'events_truncated',(SELECT count(*)>2000 FROM public.repair_events e JOIN jobs j ON j.id=e.job_id AND j.role<>'tenant')
 ) INTO result;
 RETURN result;
END;
$$;
CREATE FUNCTION public.rental_calendar_repair(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.rental_calendar_repair(p_id);
$$;
REVOKE ALL ON FUNCTION private.rental_calendar_repair(uuid), public.rental_calendar_repair(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rental_calendar_repair(uuid), public.rental_calendar_repair(uuid) TO authenticated, service_role;
