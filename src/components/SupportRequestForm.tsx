import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { supportCategories, type SupportCategory } from "@/lib/support";

type SupportRequestFormProps = {
  source: "landing" | "account";
  userId?: string | null;
  defaultName?: string;
  defaultEmail?: string;
  onSubmitted?: () => void;
  dark?: boolean;
};

export function SupportRequestForm({
  source,
  userId = null,
  defaultName = "",
  defaultEmail = "",
  onSubmitted,
  dark = false,
}: SupportRequestFormProps) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [category, setCategory] = useState<SupportCategory>("question");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    if (!name && defaultName) setName(defaultName);
    if (!email && defaultEmail) setEmail(defaultEmail);
  }, [defaultEmail, defaultName, email, name]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // A hidden field and a minimum completion time filter out basic automated spam.
    if (company || Date.now() - mountedAt.current < 1_500) {
      toast.success("Обращение отправлено");
      setMessage("");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("support_requests").insert({
      user_id: userId,
      requester_name: name.trim(),
      requester_email: email.trim().toLowerCase(),
      category,
      message: message.trim(),
      source,
    });
    setSubmitting(false);

    if (error) {
      toast.error("Не удалось отправить обращение. Попробуйте ещё раз.");
      return;
    }

    toast.success("Обращение отправлено. Мы ответим на указанный email.");
    setMessage("");
    setCategory("question");
    onSubmitted?.();
  };

  const fieldClassName = dark
    ? "border-white/15 bg-white/[0.06] text-white placeholder:text-white/35 focus-visible:ring-[#62cbd0]"
    : undefined;

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${source}-support-name`}>Имя</Label>
          <Input
            id={`${source}-support-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={120}
            autoComplete="name"
            required
            className={fieldClassName}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${source}-support-email`}>Email для ответа</Label>
          <Input
            id={`${source}-support-email`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            autoComplete="email"
            required
            className={fieldClassName}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${source}-support-category`}>Тема</Label>
        <Select value={category} onValueChange={(value) => setCategory(value as SupportCategory)}>
          <SelectTrigger
            id={`${source}-support-category`}
            className={fieldClassName}
            aria-label="Тема обращения"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {supportCategories.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${source}-support-message`}>Сообщение</Label>
        <Textarea
          id={`${source}-support-message`}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          minLength={10}
          maxLength={4000}
          rows={5}
          placeholder="Опишите вопрос и укажите важные детали"
          required
          className={fieldClassName}
        />
        <p className={dark ? "text-xs text-white/42" : "text-xs text-muted-foreground"}>
          Не указывайте пароль, данные карты или другие секретные данные.
        </p>
      </div>

      <div className="absolute -left-[10000px]" aria-hidden="true">
        <Label htmlFor={`${source}-support-company`}>Компания</Label>
        <Input
          id={`${source}-support-company`}
          name="company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <Button
        type="submit"
        disabled={submitting}
        className={dark ? "bg-[#62cbd0] text-[#101617] hover:bg-[#78d8dc]" : undefined}
      >
        {submitting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-2 h-4 w-4" />
        )}
        Отправить обращение
      </Button>
    </form>
  );
}
