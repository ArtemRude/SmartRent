import { supabase } from "@/integrations/supabase/client";

export const PROPERTY_PHOTOS = "property-photos";
export const REQUEST_PHOTOS = "request-photos";
export const AGREEMENT_INVENTORY_PHOTOS = "agreement-inventory-photos";
export const LEASE_DOCUMENTS = "lease-documents";
export const PAYMENT_RECEIPTS = "payment-receipts";
export const UTILITY_READING_PHOTOS = "utility-reading-photos";
export const HANDOVER_PHOTOS = "lease-handover-photos";

function randomName(file: File) {
  const ext = file.name.split(".").pop() ?? "bin";
  return `${crypto.randomUUID()}.${ext}`;
}

function validateFile(bucket: string, file: File) {
  const imageBuckets = new Set([
    PROPERTY_PHOTOS,
    REQUEST_PHOTOS,
    AGREEMENT_INVENTORY_PHOTOS,
    UTILITY_READING_PHOTOS,
    HANDOVER_PHOTOS,
  ]);
  if (imageBuckets.has(bucket)) {
    if (!file.type.startsWith("image/")) throw new Error("Можно загружать только изображения");
    if (file.size > 8 * 1024 * 1024) throw new Error("Размер изображения не должен превышать 8 МБ");
  }
  if (bucket === LEASE_DOCUMENTS) {
    if (file.type !== "application/pdf") throw new Error("Договор должен быть в формате PDF");
    if (file.size > 20 * 1024 * 1024) throw new Error("Размер договора не должен превышать 20 МБ");
  }
  if (
    (bucket === UTILITY_READING_PHOTOS || bucket === HANDOVER_PHOTOS) &&
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  ) {
    throw new Error(
      bucket === HANDOVER_PHOTOS
        ? "Фото осмотра должно быть в формате JPG, PNG или WebP"
        : "Фото счётчика должно быть в формате JPG, PNG или WebP",
    );
  }
  if (bucket === PAYMENT_RECEIPTS) {
    const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      throw new Error("Чек должен быть в формате PDF, JPG, PNG или WebP");
    }
    if (file.size > 10 * 1024 * 1024) throw new Error("Размер чека не должен превышать 10 МБ");
  }
}

export async function uploadFile(bucket: string, folder: string, file: File) {
  validateFile(bucket, file);
  const path = `${folder}/${randomName(file)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export async function getSignedUrl(bucket: string, path: string, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeFile(bucket: string, path: string) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

export async function downloadFile(bucket: string, path: string, fileName: string) {
  const url = await getSignedUrl(bucket, path, 120);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
