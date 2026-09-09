import { BellRing, CalendarClock, CircleAlert, CreditCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ReminderSettings } from "@/lib/queries";

type BooleanSetting = Exclude<keyof ReminderSettings, "owner_id" | "updated_at">;

function SettingRow({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: typeof BellRing;
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3">
      <span className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        </span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

export function ReminderSettingsCard({
  settings,
  saving,
  onChange,
}: {
  settings: ReminderSettings;
  saving: boolean;
  onChange: (key: BooleanSetting, value: boolean) => void;
}) {
  const rulesDisabled = saving || !settings.enabled;

  return (
    <Card className="mb-4">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Автоматические напоминания</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Проверка выполняется ежедневно, повторные уведомления не создаются
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            disabled={saving}
            onCheckedChange={(checked) => onChange("enabled", checked)}
            aria-label="Включить автоматические напоминания"
          />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <SettingRow
            icon={BellRing}
            title="Уведомлять собственника"
            description="Показывать напоминания в вашем кабинете"
            checked={settings.notify_owner}
            disabled={rulesDisabled}
            onChange={(checked) => onChange("notify_owner", checked)}
          />
          <SettingRow
            icon={BellRing}
            title="Уведомлять арендатора"
            description="Если арендатор зарегистрирован в сервисе"
            checked={settings.notify_tenant}
            disabled={rulesDisabled}
            onChange={(checked) => onChange("notify_tenant", checked)}
          />
          <SettingRow
            icon={CreditCard}
            title="Срок оплаты"
            description="За 7, 3 и 1 день, а также в день оплаты"
            checked={settings.payment_due_enabled}
            disabled={rulesDisabled}
            onChange={(checked) => onChange("payment_due_enabled", checked)}
          />
          <SettingRow
            icon={CircleAlert}
            title="Просрочка платежа"
            description="Одно уведомление после наступления просрочки"
            checked={settings.payment_overdue_enabled}
            disabled={rulesDisabled}
            onChange={(checked) => onChange("payment_overdue_enabled", checked)}
          />
          <SettingRow
            icon={CalendarClock}
            title="Окончание договора"
            description="За 30, 7 и 1 день, а также в день окончания"
            checked={settings.agreement_expiring_enabled}
            disabled={rulesDisabled}
            onChange={(checked) => onChange("agreement_expiring_enabled", checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
