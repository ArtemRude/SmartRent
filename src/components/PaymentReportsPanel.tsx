import { useState } from "react";
import { Banknote, Check, ChevronDown, Clock3, Download, ReceiptText, X } from "lucide-react";
import { PaymentReportStatusBadge } from "@/components/PaymentReportStatusBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, formatMoney } from "@/lib/domain";
import type { PaymentReport } from "@/lib/queries";

export function PaymentReportsPanel({
  reports,
  tenantName,
  propertyName,
  reviewingId,
  onReceipt,
  onReview,
}: {
  reports: PaymentReport[];
  tenantName: (tenantId: string) => string;
  propertyName: (chargeId: string) => string;
  reviewingId?: string | null;
  onReceipt: (path: string) => void;
  onReview: (reportId: string, approve: boolean, note?: string) => void;
}) {
  const [rejecting, setRejecting] = useState<PaymentReport | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const pending = reports.filter((report) => report.status === "pending");
  const reviewed = reports.filter((report) => report.status !== "pending");
  const visibleReviewed = historyExpanded ? reviewed : reviewed.slice(0, 4);

  if (reports.length === 0) return null;

  return (
    <>
      <Card className="mt-4 border-primary/20">
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Сообщения об оплате</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {pending.length > 0
                  ? "Проверьте чек или отметку о передаче наличных"
                  : "История подтверждений и отклонений"}
              </p>
            </div>
            {pending.length > 0 && (
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                {pending.length} ожидают решения
              </span>
            )}
          </div>

          {pending.length > 0 && (
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {pending.map((report) => (
                <div key={report.id} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{tenantName(report.tenant_id)}</p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {propertyName(report.charge_id)}
                      </p>
                    </div>
                    <p className="shrink-0 text-lg font-semibold">{formatMoney(report.amount)}</p>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" /> Оплачено {formatDate(report.paid_at)} ·
                      сообщено {formatDateTime(report.created_at)}
                    </p>
                    <p className="flex items-center gap-1.5">
                      {report.payment_method === "cash" ? (
                        <Banknote className="h-3.5 w-3.5" />
                      ) : (
                        <ReceiptText className="h-3.5 w-3.5" />
                      )}
                      {report.payment_method === "cash"
                        ? "Передано наличными"
                        : "Банковский перевод"}
                    </p>
                    {report.note && <p className="pt-1 text-foreground">{report.note}</p>}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {report.receipt_file && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onReceipt(report.receipt_file!)}
                      >
                        <Download className="h-4 w-4" /> Открыть чек
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" disabled={Boolean(reviewingId)}>
                          <Check className="h-4 w-4" /> Подтвердить
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Подтвердить оплату?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Платёж на сумму {formatMoney(report.amount)} будет добавлен в историю, а
                            задолженность пересчитается автоматически.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Отмена</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onReview(report.id, true)}>
                            Подтвердить
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(reviewingId)}
                      onClick={() => {
                        setReviewNote("");
                        setRejecting(report);
                      }}
                    >
                      <X className="h-4 w-4" /> Отклонить
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {reviewed.length > 0 && (
            <div className={pending.length > 0 ? "mt-6 border-t pt-5" : "mt-5"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">История решений</h3>
                <span className="text-xs text-muted-foreground">Всего: {reviewed.length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {visibleReviewed.map((report) => (
                  <div
                    key={report.id}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {tenantName(report.tenant_id)} · {propertyName(report.charge_id)}
                        </p>
                        <PaymentReportStatusBadge status={report.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatMoney(report.amount)} · {formatDate(report.paid_at)} ·{" "}
                        {report.payment_method === "cash" ? "наличными" : "банковский перевод"}
                      </p>
                      {report.review_note && (
                        <p className="mt-1 text-xs text-foreground">
                          Причина: {report.review_note}
                        </p>
                      )}
                    </div>
                    {report.receipt_file && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onReceipt(report.receipt_file!)}
                      >
                        <Download className="h-4 w-4" /> Чек
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {reviewed.length > 4 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => setHistoryExpanded((current) => !current)}
                >
                  {historyExpanded ? "Свернуть" : `Показать все (${reviewed.length})`}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${historyExpanded ? "rotate-180" : ""}`}
                  />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(rejecting)} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отклонить сообщение об оплате?</DialogTitle>
            <DialogDescription>
              Арендатор получит уведомление. Причину можно указать, чтобы было понятно, что нужно
              исправить.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payment-report-review-note">Причина</Label>
            <Textarea
              id="payment-report-review-note"
              value={reviewNote}
              maxLength={1000}
              placeholder="Например, сумма в чеке не совпадает"
              onChange={(event) => setReviewNote(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={!rejecting || Boolean(reviewingId)}
              onClick={() => {
                if (!rejecting) return;
                onReview(rejecting.id, false, reviewNote);
                setRejecting(null);
              }}
            >
              Отклонить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
