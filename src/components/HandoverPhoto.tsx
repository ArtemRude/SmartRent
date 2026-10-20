import { useState } from "react";
import { StorageImage } from "@/components/StorageImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function HandoverPhoto({
  path,
  bucket,
  label,
}: {
  path: string;
  bucket: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Открыть ${label.toLowerCase()}`}
        className="overflow-hidden rounded-lg border transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => setOpen(true)}
      >
        <StorageImage bucket={bucket} path={path} alt={label} className="aspect-square w-full" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <StorageImage
            bucket={bucket}
            path={path}
            alt={label}
            className="max-h-[70vh] w-full rounded-lg object-contain"
          />
          <Button variant="outline" onClick={() => setOpen(false)}>
            Закрыть фотографию
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
