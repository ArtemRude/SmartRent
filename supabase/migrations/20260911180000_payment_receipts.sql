-- Attach private receipt files to individual rent payments.
ALTER TABLE public.rent_payments
  ADD COLUMN receipt_file text,
  ADD CONSTRAINT rent_payments_receipt_file_length
    CHECK (char_length(receipt_file) <= 1000);

GRANT INSERT (receipt_file) ON public.rent_payments TO authenticated;

CREATE OR REPLACE FUNCTION private.validate_rent_payment_receipt_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.receipt_file IS NOT NULL
    AND split_part(NEW.receipt_file, '/', 1) <> (SELECT auth.uid())::text
  THEN
    RAISE EXCEPTION 'receipt must be uploaded to the current user folder'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.validate_rent_payment_receipt_path()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER validate_rent_payment_receipt_path_before_write
  BEFORE INSERT OR UPDATE OF receipt_file ON public.rent_payments
  FOR EACH ROW EXECUTE FUNCTION private.validate_rent_payment_receipt_path();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "payment_receipts_insert_owner"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (
      (SELECT private.has_role((SELECT auth.uid()), 'owner'::public.app_role))
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
    )
  );

CREATE POLICY "payment_receipts_select_authorized"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::public.app_role))
      OR EXISTS (
        SELECT 1
        FROM public.rent_payments AS payment
        WHERE payment.receipt_file = objects.name
          AND (
            payment.owner_id = (SELECT auth.uid())
            OR private.is_my_tenant_record(payment.tenant_id)
          )
      )
    )
  );

CREATE POLICY "payment_receipts_delete_uploader"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND owner_id = (SELECT auth.uid())::text
  );
