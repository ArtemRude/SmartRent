SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.agreement_acceptances
  ADD COLUMN photos text[] NOT NULL DEFAULT '{}'::text[],
  ADD CONSTRAINT agreement_acceptances_photos_limit
    CHECK (cardinality(photos) <= 6),
  ADD CONSTRAINT agreement_acceptances_photos_not_null
    CHECK (array_position(photos, NULL) IS NULL),
  ADD CONSTRAINT agreement_acceptances_photos_length
    CHECK (octet_length(array_to_string(photos, '')) <= 6144);

COMMENT ON COLUMN public.agreement_acceptances.photos IS
  'Optional private condition photos attached when the tenant signs the agreement and accepts its inventory.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agreement-inventory-photos',
  'agreement-inventory-photos',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY agreement_inventory_photos_insert_tenant
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'agreement-inventory-photos'
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

CREATE POLICY agreement_inventory_photos_select_participants
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'agreement-inventory-photos'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR EXISTS (
        SELECT 1
        FROM public.agreement_acceptances AS acceptance
        WHERE storage.objects.name = ANY(acceptance.photos)
      )
    )
  );

CREATE POLICY agreement_inventory_photos_delete_unattached
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'agreement-inventory-photos'
    AND owner_id = (SELECT auth.uid())::text
    AND NOT EXISTS (
      SELECT 1
      FROM public.agreement_acceptances AS acceptance
      WHERE storage.objects.name = ANY(acceptance.photos)
    )
  );

CREATE OR REPLACE FUNCTION public.submit_tenant_agreement(
  p_agreement_id uuid,
  p_agreement_version timestamptz,
  p_document_path text,
  p_photo_paths text[] DEFAULT '{}'::text[]
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
  photo_path text;
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

  IF p_photo_paths IS NULL OR cardinality(p_photo_paths) > 6 THEN
    RAISE EXCEPTION 'Можно приложить не более 6 фотографий' USING ERRCODE = '22023';
  END IF;

  FOREACH photo_path IN ARRAY p_photo_paths LOOP
    IF photo_path IS NULL
      OR length(photo_path) > 1024
      OR position(expected_prefix IN photo_path) <> 1
    THEN
      RAISE EXCEPTION 'Недопустимый путь фотографии имущества' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT agreement.signed_document_file
  INTO previous_path
  FROM public.lease_agreements AS agreement
  JOIN public.tenants AS tenant ON tenant.id = agreement.tenant_id
  WHERE agreement.id = p_agreement_id
    AND tenant.user_id = caller_id
    AND agreement.status = 'pending_signature'
    AND agreement.status_changed_at = p_agreement_version
  FOR UPDATE OF agreement;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Договор недоступен для подписания' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects AS object
    WHERE object.bucket_id = 'lease-documents'
      AND object.name = p_document_path
      AND object.owner_id = caller_id::text
  ) THEN
    RAISE EXCEPTION 'Загруженный PDF не найден' USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(*)
    FROM storage.objects AS object
    WHERE object.bucket_id = 'agreement-inventory-photos'
      AND object.name = ANY(p_photo_paths)
      AND object.owner_id = caller_id::text
  ) <> cardinality(p_photo_paths) THEN
    RAISE EXCEPTION 'Одна или несколько фотографий не найдены' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agreement_acceptances (
    agreement_id,
    agreement_version,
    accepted_by,
    photos
  )
  VALUES (
    p_agreement_id,
    p_agreement_version,
    caller_id,
    p_photo_paths
  );

  UPDATE public.lease_agreements
  SET signed_document_file = p_document_path
  WHERE id = p_agreement_id;

  RETURN previous_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_tenant_agreement(uuid, timestamptz, text, text[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_tenant_agreement(uuid, timestamptz, text, text[])
  TO authenticated;
