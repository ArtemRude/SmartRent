import { supabase } from "@/integrations/supabase/client";

export const PROPERTY_PHOTOS = "property-photos";
export const REQUEST_PHOTOS = "request-photos";
export const LEASE_DOCUMENTS = "lease-documents";

function randomName(file: File) {
  const ext = file.name.split(".").pop() ?? "bin";
  return `${crypto.randomUUID()}.${ext}`;
}

export async function uploadFile(bucket: string, folder: string, file: File) {
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
