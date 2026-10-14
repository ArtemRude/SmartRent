import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FileUploadField({
  id,
  file,
  onFileChange,
  accept,
  description,
  buttonLabel = "Выбрать PDF",
  disabled = false,
  className,
}: {
  id: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept: string;
  description: string;
  buttonLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/20 p-3 sm:flex-row sm:items-center",
        file && "border-primary/30 bg-primary/5",
        className,
      )}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground shadow-sm">
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", file ? "font-medium" : "text-muted-foreground")}>
          {file?.name ?? description}
        </p>
        {file && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {(file.size / 1024 / 1024).toLocaleString("ru-RU", {
              maximumFractionDigits: 1,
            })}{" "}
            МБ
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {file && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Убрать выбранный файл"
            onClick={() => onFileChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" disabled={disabled} asChild>
          <label htmlFor={id} className="cursor-pointer">
            <Upload className="mr-2 h-4 w-4" />
            {file ? "Заменить" : buttonLabel}
          </label>
        </Button>
        <input
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            onFileChange(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </div>
    </div>
  );
}
