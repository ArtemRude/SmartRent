-- Existing production projects can have the foundation migration recorded
-- while some of its public RLS helpers are missing. Restore the complete
-- compatibility set before later migrations move the helpers to `private`.
CREATE OR REPLACE FUNCTION public.has_role(
  _user_id uuid,
  _role public.app_role
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_my_tenant_record(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants AS t
    WHERE t.id = _tenant_id
      AND t.user_id = (SELECT auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION public.owns_property(_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.properties AS p
    WHERE p.id = _property_id
      AND p.owner_id = (SELECT auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION public.tenant_can_see_property(_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.lease_agreements AS la
    JOIN public.tenants AS t ON t.id = la.tenant_id
    WHERE la.property_id = _property_id
      AND t.user_id = (SELECT auth.uid())
      AND la.status = 'active'
      AND CURRENT_DATE BETWEEN la.start_date AND la.end_date
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_see_request(_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.requests AS r
    LEFT JOIN public.tenants AS t ON t.id = r.tenant_id
    WHERE r.id = _request_id
      AND (
        r.owner_id = (SELECT auth.uid())
        OR t.user_id = (SELECT auth.uid())
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.lease_relationship_is_valid(
  _owner_id uuid,
  _property_id uuid,
  _unit_id uuid,
  _tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.properties AS p
    JOIN public.tenants AS t
      ON t.id = _tenant_id
     AND t.owner_id = _owner_id
    WHERE p.id = _property_id
      AND p.owner_id = _owner_id
      AND (
        _unit_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.units AS u
          WHERE u.id = _unit_id
            AND u.property_id = _property_id
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.tenant_can_create_request(
  _tenant_id uuid,
  _owner_id uuid,
  _property_id uuid,
  _unit_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants AS t
    JOIN public.lease_agreements AS la ON la.tenant_id = t.id
    WHERE t.id = _tenant_id
      AND t.user_id = (SELECT auth.uid())
      AND la.owner_id = _owner_id
      AND la.property_id = _property_id
      AND (_unit_id IS NULL OR la.unit_id = _unit_id)
      AND la.status = 'active'
      AND CURRENT_DATE BETWEEN la.start_date AND la.end_date
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_my_tenant_record(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.owns_property(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tenant_can_see_property(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_see_request(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.lease_relationship_is_valid(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tenant_can_create_request(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_tenant_record(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_property(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_can_see_property(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_request(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.lease_relationship_is_valid(uuid, uuid, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_can_create_request(uuid, uuid, uuid, uuid)
  TO authenticated;
