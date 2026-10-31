SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Search projects existing permissions; it does not grant access to raw team,
-- tenant or contract tables. Every branch authorizes its own entity first.
CREATE FUNCTION private.workspace_search(p_query text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
  administrator boolean;
  tenant_mode boolean;
  needle text := replace(lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g')), 'ё', 'е');
  result jsonb;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE = '42501'; END IF;
  IF length(needle) > 100 THEN RAISE EXCEPTION 'Поисковый запрос слишком длинный' USING ERRCODE = '22023'; END IF;
  IF length(needle) < 2 THEN RETURN jsonb_build_object('items', '[]'::jsonb, 'has_more', false); END IF;
  administrator := private.has_role(caller, 'admin');
  tenant_mode := private.has_role(caller, 'tenant');

  WITH property_access AS MATERIALIZED (
    SELECT p.id, p.owner_id, p.name, p.address, p.status,
      (p.owner_id = caller OR administrator) AS owner_access,
      EXISTS (SELECT 1 FROM public.team_memberships m
        JOIN public.team_property_access g ON g.membership_id = m.id AND g.property_id = p.id
        WHERE m.owner_id = p.owner_id AND m.user_id = caller AND m.status = 'active') AS team_access,
      tenancy.id AS agreement_id
    FROM public.properties p
    LEFT JOIN LATERAL (
      SELECT a.id FROM public.lease_agreements a
      JOIN public.tenants t ON t.id = a.tenant_id AND t.owner_id = a.owner_id
      WHERE a.property_id = p.id AND a.owner_id = p.owner_id AND t.user_id = caller
        AND (a.status IN ('pending_signature', 'completed')
          OR (a.status = 'active' AND CURRENT_DATE BETWEEN a.start_date AND a.end_date))
      ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'pending_signature' THEN 1 ELSE 2 END,
        a.end_date DESC, a.id
      LIMIT 1
    ) tenancy ON true
  ), properties AS MATERIALIZED (
    SELECT * FROM property_access WHERE owner_access OR team_access OR agreement_id IS NOT NULL
  ), candidates AS (
    SELECT 'property'::text AS kind, p.id, p.name AS title, p.address AS subtitle,
      p.status, p.id AS property_id, p.agreement_id,
      CASE WHEN p.owner_access THEN 'owner' WHEN p.team_access THEN 'team' ELSE 'tenant' END AS access,
      concat_ws(' ', p.name, p.address, p.id::text) AS searchable
    FROM properties p

    UNION ALL
    SELECT 'tenant', t.id, t.name, t.email, NULL::text, NULL::uuid, NULL::uuid, 'owner',
      concat_ws(' ', t.name, t.email, t.phone, t.id::text)
    -- The tenant cabinet has no tenant-directory destination after a role change.
    FROM public.tenants t WHERE NOT tenant_mode AND (t.owner_id = caller OR administrator)

    UNION ALL
    SELECT 'agreement', a.id,
      'Договор' || CASE WHEN jsonb_typeof(a.contract_details->'agreementNumber') = 'string'
        AND btrim(a.contract_details->>'agreementNumber') <> ''
        THEN ' № ' || (a.contract_details->>'agreementNumber') ELSE '' END || ' · ' || coalesce(p.name, 'Аренда'),
      concat_ws(' · ', t.name, u.name, a.start_date::text || ' — ' || a.end_date::text),
      a.status::text, a.property_id, a.id,
      CASE WHEN a.owner_id = caller OR administrator THEN 'owner' ELSE 'tenant' END,
      concat_ws(' ', a.id::text, p.name, p.address, t.name, u.name, a.start_date::text, a.end_date::text,
        CASE WHEN jsonb_typeof(a.contract_details->'agreementNumber') = 'string'
          THEN a.contract_details->>'agreementNumber' END)
    FROM public.lease_agreements a
    JOIN public.tenants t ON t.id = a.tenant_id AND t.owner_id = a.owner_id
    LEFT JOIN properties p ON p.id = a.property_id AND p.owner_id = a.owner_id
    LEFT JOIN public.units u ON u.id = a.unit_id AND u.property_id = p.id
    WHERE (NOT tenant_mode AND (a.owner_id = caller OR administrator))
      OR (t.user_id = caller AND a.status IN ('pending_signature', 'active', 'completed'))

    UNION ALL
    SELECT 'request', r.id, r.title, coalesce(p.name, 'Заявка арендатора'), r.status::text,
      r.property_id, NULL::uuid,
      CASE WHEN r.owner_id = caller OR administrator THEN 'owner'
        WHEN p.team_access AND p.owner_id = r.owner_id THEN 'team' ELSE 'tenant' END,
      concat_ws(' ', r.title, r.id::text, p.name,
        CASE WHEN r.owner_id = caller OR administrator OR (p.team_access AND p.owner_id = r.owner_id)
          THEN t.name END)
    FROM public.requests r
    LEFT JOIN public.tenants t ON t.id = r.tenant_id AND t.owner_id = r.owner_id
    LEFT JOIN properties p ON p.id = r.property_id AND p.owner_id = r.owner_id
    WHERE r.owner_id = caller OR administrator OR t.user_id = caller
      OR (p.team_access AND p.owner_id = r.owner_id)
  ), matched AS (
    SELECT c.*, CASE WHEN strpos(replace(lower(c.title), 'ё', 'е'), needle) = 1 THEN 0 ELSE 1 END AS rank
    FROM candidates c
    -- strpos treats %, _, quotes and backslashes literally, with no SQL/filter interpolation.
    WHERE strpos(replace(lower(c.searchable), 'ё', 'е'), needle) > 0
  ), ranked AS (
    SELECT m.*, row_number() OVER (PARTITION BY kind ORDER BY rank, lower(title), id) AS position
    FROM matched m
  ), bounded AS MATERIALIZED (SELECT * FROM ranked WHERE position <= 11)
  SELECT jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'kind', kind, 'id', id,
      'title', left(coalesce(nullif(btrim(title), ''), 'Запись'), 500),
      'subtitle', left(coalesce(subtitle, ''), 1500), 'status', left(status, 100),
      'property_id', property_id, 'agreement_id', agreement_id, 'access', access
    ) ORDER BY kind, rank, lower(title), id) FROM bounded WHERE position <= 10), '[]'::jsonb),
    'has_more', EXISTS (SELECT 1 FROM bounded WHERE position = 11)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.workspace_search(p_query text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.workspace_search(p_query);
$$;
REVOKE ALL ON FUNCTION private.workspace_search(text), public.workspace_search(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.workspace_search(text), public.workspace_search(text) TO authenticated, service_role;

-- Resolve a selected team request independently of the workspace's latest-200 cap.
-- This projection contains exactly the request fields already visible in that workspace.
CREATE FUNCTION private.workspace_search_team_request(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Войдите в аккаунт' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('property_id', p.id, 'request', jsonb_build_object(
    'id', r.id, 'title', r.title, 'description', r.description, 'category', r.category,
    'status', r.status, 'created_at', r.created_at,
    'tenant_name', coalesce(t.name, 'Арендатор'), 'unit_name', u.name
  )) INTO result
  FROM public.requests r
  JOIN public.properties p ON p.id = r.property_id AND p.owner_id = r.owner_id
  LEFT JOIN public.tenants t ON t.id = r.tenant_id AND t.owner_id = r.owner_id
  LEFT JOIN public.units u ON u.id = r.unit_id AND u.property_id = p.id
  WHERE r.id = p_id AND (private.team_has_access(p.id, false) OR private.has_role(auth.uid(), 'admin'));
  RETURN result;
END;
$$;
CREATE FUNCTION public.workspace_search_team_request(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.workspace_search_team_request(p_id);
$$;
REVOKE ALL ON FUNCTION private.workspace_search_team_request(uuid), public.workspace_search_team_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.workspace_search_team_request(uuid), public.workspace_search_team_request(uuid) TO authenticated, service_role;
