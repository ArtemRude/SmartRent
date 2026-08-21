-- Provision private buckets as part of reproducible project setup.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('property-photos', 'property-photos', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('request-photos', 'request-photos', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('lease-documents', 'lease-documents', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

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
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.properties p
    JOIN public.tenants t ON t.id = _tenant_id AND t.owner_id = _owner_id
    WHERE p.id = _property_id
      AND p.owner_id = _owner_id
      AND (
        _unit_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.units u
          WHERE u.id = _unit_id AND u.property_id = _property_id
        )
      )
  );
$$;

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
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.lease_agreements la ON la.tenant_id = t.id
    WHERE t.id = _tenant_id
      AND t.user_id = auth.uid()
      AND la.owner_id = _owner_id
      AND la.property_id = _property_id
      AND (_unit_id IS NULL OR la.unit_id = _unit_id)
      AND la.status = 'active'
      AND CURRENT_DATE BETWEEN la.start_date AND la.end_date
  );
$$;

REVOKE EXECUTE ON FUNCTION public.lease_relationship_is_valid(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tenant_can_create_request(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_relationship_is_valid(uuid, uuid, uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_can_create_request(uuid, uuid, uuid, uuid)
  TO authenticated;

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "leases_owner_all" ON public.lease_agreements;
CREATE POLICY "leases_admin_all" ON public.lease_agreements
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "leases_owner_select" ON public.lease_agreements
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "leases_owner_insert" ON public.lease_agreements
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND public.lease_relationship_is_valid(owner_id, property_id, unit_id, tenant_id)
  );
CREATE POLICY "leases_owner_update" ON public.lease_agreements
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND public.lease_relationship_is_valid(owner_id, property_id, unit_id, tenant_id)
  );
CREATE POLICY "leases_owner_delete" ON public.lease_agreements
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "requests_owner_all" ON public.requests;
DROP POLICY IF EXISTS "requests_tenant_insert" ON public.requests;
CREATE POLICY "requests_admin_all" ON public.requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "requests_owner_select" ON public.requests
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "requests_owner_update" ON public.requests
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (
    owner_id = auth.uid()
    AND public.lease_relationship_is_valid(owner_id, property_id, unit_id, tenant_id)
  );
CREATE POLICY "requests_owner_delete" ON public.requests
  FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "requests_tenant_insert" ON public.requests
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'new'
    AND public.tenant_can_create_request(tenant_id, owner_id, property_id, unit_id)
  );

DROP POLICY IF EXISTS "media_read_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "media_upload_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "media_delete_own" ON storage.objects;
DROP POLICY IF EXISTS "lease_docs_insert" ON storage.objects;
DROP POLICY IF EXISTS "lease_docs_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "lease_docs_owner_delete" ON storage.objects;

CREATE POLICY "property_photos_insert_own_folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (
      public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'admin')
    )
  );
CREATE POLICY "property_photos_select_authorized" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'property-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.properties p
        WHERE storage.objects.name = ANY(p.photos)
          AND (p.owner_id = auth.uid() OR public.tenant_can_see_property(p.id))
      )
    )
  );
CREATE POLICY "property_photos_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'property-photos' AND owner = auth.uid());

CREATE POLICY "request_photos_insert_own_folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'request-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "request_photos_select_authorized" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'request-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.requests r
        WHERE r.photo = storage.objects.name AND public.can_see_request(r.id)
      )
    )
  );
CREATE POLICY "request_photos_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'request-photos' AND owner = auth.uid());

CREATE POLICY "lease_documents_insert_owner" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (
      public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'admin')
    )
  );
CREATE POLICY "lease_documents_select_authorized" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lease-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.lease_agreements la
        WHERE la.document_file = storage.objects.name
          AND (la.owner_id = auth.uid() OR public.is_my_tenant_record(la.tenant_id))
      )
    )
  );
CREATE POLICY "lease_documents_delete_owner" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lease-documents' AND owner = auth.uid());
