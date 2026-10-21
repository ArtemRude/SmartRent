import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { getSignedUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

export function StorageImage({
  bucket,
  path,
  alt,
  className,
  expiresIn = 3600,
  refreshInterval,
}: {
  bucket: string;
  path?: string | null | undefined;
  alt: string;
  className?: string;
  expiresIn?: number;
  refreshInterval?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    setUrl(null);
    const load = () =>
      getSignedUrl(bucket, path, expiresIn)
        .then((u) => active && setUrl(u))
        .catch(() => active && setUrl(null));
    void load();
    const timer = refreshInterval ? setInterval(() => void load(), refreshInterval) : undefined;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [bucket, path, expiresIn, refreshInterval]);

  if (!url) {
    return (
      <div
        className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
        aria-label={alt}
      >
        <ImageIcon className="h-6 w-6 opacity-50" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setUrl(null)}
      className={cn("object-cover", className)}
    />
  );
}
