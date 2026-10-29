SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Repair deployed drift: unqualified `name` inside the subquery resolved to
-- tenants.name instead of the uploaded object's path. Keep the same tenant,
-- folder and pending-signature restrictions; no wider access is granted.
ALTER POLICY lease_documents_insert_tenant_signed ON storage.objects
  TO authenticated
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND (storage.foldername(storage.objects.name))[1] = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.lease_agreements AS agreement
      JOIN public.tenants AS tenant ON tenant.id = agreement.tenant_id
      WHERE agreement.id::text = (storage.foldername(storage.objects.name))[2]
        AND tenant.user_id = (SELECT auth.uid())
        AND agreement.status = 'pending_signature'
    )
  );
