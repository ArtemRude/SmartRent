import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { getSignedUrl, LISTING_PHOTOS } from "@/lib/storage";
export function ListingPhoto({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    const load = () =>
      getSignedUrl(LISTING_PHOTOS, path, 120)
        .then((u) => {
          if (live) setUrl(u);
        })
        .catch(() => {
          if (live) setUrl(null);
        });
    void load();
    const timer = setInterval(() => void load(), 90000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path]);
  return url ? (
    <img src={url} alt={alt} className="aspect-[4/3] w-full rounded-xl object-cover" />
  ) : (
    <div
      role="img"
      aria-label={alt}
      className="grid aspect-[4/3] place-items-center rounded-xl bg-muted"
    >
      <ImageIcon className="h-9 w-9 text-muted-foreground" />
    </div>
  );
}
