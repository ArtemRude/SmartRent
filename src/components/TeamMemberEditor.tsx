import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inviteTeamMember, manageTeamMember } from "@/lib/team-queries";
import {
  teamRoleDescriptions,
  teamRoleLabels,
  type TeamMember,
  type TeamProperty,
  type TeamRole,
} from "@/lib/team";

export type CreatedTeamInvitation = { membership_id: string; token: string; expires_at: string };
export function TeamMemberEditor({
  member,
  properties,
  onClose,
  onSaved,
}: {
  member: TeamMember | null;
  properties: TeamProperty[];
  onClose: () => void;
  onSaved: (invitation?: CreatedTeamInvitation) => void;
}) {
  const [email, setEmail] = useState(member?.email ?? "");
  const [role, setRole] = useState<TeamRole>(member?.role ?? "manager");
  const [propertyIds, setPropertyIds] = useState<string[]>(member?.property_ids ?? []);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      setError("");
      if (!propertyIds.length) throw new Error("Выберите хотя бы один объект");
      if (member) {
        await manageTeamMember(member, { role, propertyIds });
        return undefined;
      }
      if (!email.trim()) throw new Error("Укажите email сотрудника");
      return inviteTeamMember({ email, role, propertyIds });
    },
    onSuccess: (invitation) => {
      toast.success(member ? "Доступ обновлён" : "Приглашение создано");
      onSaved(invitation);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{member ? "Изменить доступ" : "Пригласить сотрудника"}</DialogTitle>
          <DialogDescription>
            Доступ только к выбранным объектам. Платежи, документы, персональные контакты и
            управление командой остаются у собственника.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="team-email">Email сотрудника</Label>
            <Input
              id="team-email"
              type="email"
              required
              maxLength={254}
              value={email}
              disabled={Boolean(member)}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!member && (
              <p className="text-xs text-muted-foreground">
                Сотрудник должен войти с этим email. Ссылку нужно передать самостоятельно; письмо не
                отправляется.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-role">Роль в команде</Label>
            <select
              id="team-role"
              value={role}
              onChange={(e) => setRole(e.target.value as TeamRole)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="manager">{teamRoleLabels.manager}</option>
              <option value="viewer">{teamRoleLabels.viewer}</option>
            </select>
            <p className="text-xs text-muted-foreground">{teamRoleDescriptions[role]}</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Доступ к объектам</legend>
            {properties.map((property) => (
              <label
                key={property.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  checked={propertyIds.includes(property.id)}
                  onChange={(e) =>
                    setPropertyIds((ids) =>
                      e.target.checked
                        ? [...ids, property.id]
                        : ids.filter((id) => id !== property.id),
                    )
                  }
                />
                <span className="min-w-0 break-words">
                  <span className="block font-medium">{property.name}</span>
                  <span className="text-muted-foreground">{property.address}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Сохраняем…" : member ? "Сохранить доступ" : "Создать приглашение"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
