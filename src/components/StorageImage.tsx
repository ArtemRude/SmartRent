import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { getSignedUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

export function StorageImage({
  bucket,
  path,
  alt,
  className,
}: {
  bucket: string;
  path?: string | null;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    getSignedUrl(bucket, path)
      .then((u) => active && setUrl(u))
      .catch(() => active && setUrl(null));
    return () => {
      active = false;
    };
  }, [bucket, path]);

  if (!url) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
        aria-label={alt}
      >
        <ImageIcon className="h-6 w-6 opacity-50" />
      </div>
    );
  }

  return <img src={url} alt={alt} loading="lazy" className={cn("object-cover", className)} />;
}
