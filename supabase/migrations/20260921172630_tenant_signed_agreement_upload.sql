SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP POLICY IF EXISTS lease_documents_insert_tenant_signed ON storage.objects;
CREATE POLICY lease_documents_insert_tenant_signed
  ON storage.objects
  FOR INSERT
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

CREATE OR REPLACE FUNCTION public.submit_signed_agreement(
  p_agreement_id uuid,
  p_document_path text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  expected_prefix text;
  previous_path text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация' USING ERRCODE = '28000';
  END IF;

  expected_prefix := caller_id::text || '/' || p_agreement_id::text || '/';
  IF p_document_path IS NULL
    OR length(p_document_path) > 1024
    OR position(expected_prefix IN p_document_path) <> 1
  THEN
    RAISE EXCEPTION 'Недопустимый путь подписанного договора' USING ERRCODE = '22023';
  END IF;

  SELECT agreement.signed_document_file
  INTO previous_path
  FROM public.lease_agreements AS agreement
  JOIN public.tenants AS tenant ON tenant.id = agreement.tenant_id
  WHERE agreement.id = p_agreement_id
    AND tenant.user_id = caller_id
    AND agreement.status = 'pending_signature'
  FOR UPDATE OF agreement;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Договор недоступен для отправки' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'lease-documents'
      AND object.name = p_document_path
      AND object.owner = caller_id
  ) THEN
    RAISE EXCEPTION 'Загруженный PDF не найден' USING ERRCODE = '22023';
  END IF;

  UPDATE public.lease_agreements
  SET signed_document_file = p_document_path
  WHERE id = p_agreement_id;

  RETURN previous_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_signed_agreement(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_signed_agreement(uuid, text)
  TO authenticated;
