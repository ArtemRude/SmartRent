-- Keep SECURITY DEFINER helpers out of the API-exposed public schema.
-- They remain callable from RLS policies by authenticated sessions only.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
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

CREATE OR REPLACE FUNCTION private.is_my_tenant_record(_tenant_id uuid)
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

CREATE OR REPLACE FUNCTION private.owns_property(_property_id uuid)
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

CREATE OR REPLACE FUNCTION private.tenant_can_see_property(_property_id uuid)
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

CREATE OR REPLACE FUNCTION private.can_see_request(_request_id uuid)
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
      AND (r.owner_id = (SELECT auth.uid()) OR t.user_id = (SELECT auth.uid()))
  );
$function$;

CREATE OR REPLACE FUNCTION private.lease_relationship_is_valid(
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

CREATE OR REPLACE FUNCTION private.tenant_can_create_request(
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

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

ALTER POLICY comments_insert ON public.comments
  WITH CHECK ((user_id = (SELECT auth.uid())) AND private.can_see_request(request_id));
ALTER POLICY comments_select ON public.comments
  USING (private.can_see_request(request_id) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

ALTER POLICY leases_admin_all ON public.lease_agreements
  USING ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
ALTER POLICY leases_owner_insert ON public.lease_agreements
  WITH CHECK ((owner_id = (SELECT auth.uid())) AND private.lease_relationship_is_valid(owner_id, property_id, unit_id, tenant_id));
ALTER POLICY leases_owner_update ON public.lease_agreements
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK ((owner_id = (SELECT auth.uid())) AND private.lease_relationship_is_valid(owner_id, property_id, unit_id, tenant_id));
ALTER POLICY leases_tenant_select ON public.lease_agreements
  USING (private.is_my_tenant_record(tenant_id));

ALTER POLICY profiles_select_self_or_admin ON public.profiles
  USING ((id = (SELECT auth.uid())) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
ALTER POLICY profiles_update_self_or_admin ON public.profiles
  USING ((id = (SELECT auth.uid())) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((id = (SELECT auth.uid())) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

ALTER POLICY properties_owner_all ON public.properties
  USING ((owner_id = (SELECT auth.uid())) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((owner_id = (SELECT auth.uid())) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
ALTER POLICY properties_tenant_select ON public.properties
  USING (private.tenant_can_see_property(id));

ALTER POLICY rent_charges_admin_select ON public.rent_charges
  USING ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
ALTER POLICY rent_charges_admin_update ON public.rent_charges
  USING ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
ALTER POLICY rent_charges_tenant_select ON public.rent_charges
  USING (private.is_my_tenant_record(tenant_id));

ALTER POLICY requests_admin_all ON public.requests
  USING ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
ALTER POLICY requests_owner_update ON public.requests
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK ((owner_id = (SELECT auth.uid())) AND private.lease_relationship_is_valid(owner_id, property_id, unit_id, tenant_id));
ALTER POLICY requests_tenant_insert ON public.requests
  WITH CHECK (
    status = 'new'::public.request_status
    AND private.tenant_can_create_request(tenant_id, owner_id, property_id, unit_id)
  );
ALTER POLICY requests_tenant_select ON public.requests
  USING (private.is_my_tenant_record(tenant_id));

ALTER POLICY tenants_owner_all ON public.tenants
  USING ((owner_id = (SELECT auth.uid())) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((owner_id = (SELECT auth.uid())) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

ALTER POLICY units_owner_all ON public.units
  USING (private.owns_property(property_id) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK (private.owns_property(property_id) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
ALTER POLICY units_tenant_select ON public.units
  USING (private.tenant_can_see_property(property_id));

ALTER POLICY user_roles_admin_update ON public.user_roles
  USING ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
ALTER POLICY user_roles_select_self_or_admin ON public.user_roles
  USING ((user_id = (SELECT auth.uid())) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

ALTER POLICY lease_documents_insert_owner ON storage.objects
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      (SELECT private.has_role((SELECT auth.uid()), 'owner'::public.app_role))
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    )
  );
ALTER POLICY lease_documents_select_authorized ON storage.objects
  USING (
    bucket_id = 'lease-documents'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR EXISTS (
        SELECT 1
        FROM public.lease_agreements AS la
        WHERE la.document_file = objects.name
          AND (
            la.owner_id = (SELECT auth.uid())
            OR private.is_my_tenant_record(la.tenant_id)
          )
      )
    )
  );
ALTER POLICY property_photos_insert_own_folder ON storage.objects
  WITH CHECK (
    bucket_id = 'property-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      (SELECT private.has_role((SELECT auth.uid()), 'owner'::public.app_role))
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    )
  );
ALTER POLICY property_photos_select_authorized ON storage.objects
  USING (
    bucket_id = 'property-photos'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR EXISTS (
        SELECT 1
        FROM public.properties AS p
        WHERE objects.name = ANY (p.photos)
          AND (
            p.owner_id = (SELECT auth.uid())
            OR private.tenant_can_see_property(p.id)
          )
      )
    )
  );
ALTER POLICY request_photos_select_authorized ON storage.objects
  USING (
    bucket_id = 'request-photos'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR EXISTS (
        SELECT 1
        FROM public.requests AS r
        WHERE r.photo = objects.name
          AND private.can_see_request(r.id)
      )
    )
  );

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.is_my_tenant_record(uuid);
DROP FUNCTION IF EXISTS public.owns_property(uuid);
DROP FUNCTION IF EXISTS public.tenant_can_see_property(uuid);
DROP FUNCTION IF EXISTS public.can_see_request(uuid);
DROP FUNCTION IF EXISTS public.lease_relationship_is_valid(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.tenant_can_create_request(uuid, uuid, uuid, uuid);
