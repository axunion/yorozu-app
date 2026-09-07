import { jstDayRange, todayJst } from "@yorozu/core";
import { apiFetch, jsonFetch } from "@yorozu/core/client";
import { Button, ConfirmDialog, ErrorAlert, Field } from "@yorozu/ui";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import styles from "./SalesHistory.module.css";
import StatusBadge from "./StatusBadge";

type SalesItem = {
  id: string;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  status: "ordered" | "served" | "cancelled";
};

type PaymentMethod = "cash" | "card" | "qr";

type Payment = {
  id: string;
  order_id: string;
  seat_name: string;
  total_amount: number;
  method: PaymentMethod;
  discount_amount: number;
  discount_reason: string | null;
  paid_at: number;
  voided_at: number | null;
  void_reason: string | null;
  items: SalesItem[];
};

/** The pre-discount items total: what's actually charged is total_amount. */
function itemsTotal(payment: Payment): number {
  return payment.total_amount + payment.discount_amount;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "現金",
  card: "カード",
  qr: "QR決済",
};

/** Shifts a "YYYY-MM-DD" calendar date by `deltaDays`, using UTC arithmetic
 * so month/year rollovers are handled by the platform's Date implementation. */
export function shiftDate(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + deltaDays),
  );
  return shifted.toISOString().slice(0, 10);
}

const formatCurrency = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });

export default function SalesHistory() {
  const [date, setDate] = createSignal(todayJst());
  const [payments, setPayments] = createSignal<Payment[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [actionError, setActionError] = createSignal("");
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [voidReasonOpen, setVoidReasonOpen] = createSignal<Set<string>>(
    new Set(),
  );
  const [voidReasonByPayment, setVoidReasonByPayment] = createSignal<
    Map<string, string>
  >(new Map());
  const [voiding, setVoiding] = createSignal<Set<string>>(new Set());

  const voidReasonFor = (paymentId: string): string =>
    voidReasonByPayment().get(paymentId) ?? "";

  const setVoidReason = (paymentId: string, reason: string) => {
    setVoidReasonByPayment((prev) => new Map(prev).set(paymentId, reason));
  };

  const toggleVoidReasonOpen = (paymentId: string) => {
    setVoidReasonOpen((prev) => {
      const next = new Set(prev);
      if (next.has(paymentId)) {
        next.delete(paymentId);
        setVoidReason(paymentId, "");
      } else {
        next.add(paymentId);
      }
      return next;
    });
  };

  async function handleVoid(paymentId: string) {
    setActionError("");
    setVoiding((prev) => new Set([...prev, paymentId]));
    try {
      const result = await jsonFetch(
        `/api/payments/${paymentId}/void`,
        "PATCH",
        {
          void_reason: voidReasonFor(paymentId).trim(),
        },
      );
      if (!result.ok) {
        setActionError(result.message ?? "取消処理に失敗しました。");
        return;
      }
      await load();
    } finally {
      setVoiding((prev) => {
        const next = new Set(prev);
        next.delete(paymentId);
        return next;
      });
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    const { from, to } = jstDayRange(date());
    const result = await apiFetch<Payment[]>(
      `/api/payments?from=${from}&to=${to}`,
    );
    if (result.ok && result.data) {
      setPayments(result.data);
    } else {
      setPayments([]);
      setError(result.message ?? "売上データの取得に失敗しました。");
    }
    setLoading(false);
  }

  createEffect(() => {
    date();
    load();
  });

  // Voided payments stay in the list (for audit/history, struck through)
  // but never count toward revenue.
  const settledPayments = createMemo(() =>
    payments().filter((p) => p.voided_at === null),
  );
  const totalRevenue = createMemo(() =>
    settledPayments().reduce((sum, p) => sum + p.total_amount, 0),
  );
  const checkCount = createMemo(() => settledPayments().length);
  const averagePerCheck = createMemo(() =>
    checkCount() === 0 ? 0 : Math.round(totalRevenue() / checkCount()),
  );
  const methodTotals = createMemo(() => {
    const totals = new Map<PaymentMethod, number>();
    for (const p of settledPayments()) {
      totals.set(p.method, (totals.get(p.method) ?? 0) + p.total_amount);
    }
    return (Object.keys(METHOD_LABELS) as PaymentMethod[]).map((method) => ({
      method,
      label: METHOD_LABELS[method],
      amount: totals.get(method) ?? 0,
    }));
  });

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div class={styles.salesHistory}>
      <div class={styles.dateNav}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDate(shiftDate(date(), -1))}
        >
          ← 前日
        </Button>
        <input
          type="date"
          class={styles.dateInput}
          aria-label="日付"
          value={date()}
          onInput={(e) => setDate(e.currentTarget.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setDate(shiftDate(date(), 1))}
        >
          翌日 →
        </Button>
      </div>

      <Show when={actionError()}>
        <ErrorAlert>{actionError()}</ErrorAlert>
      </Show>
      <Show when={error() && !actionError()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <Show when={!loading() && !error()}>
        <div class={styles.stats}>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>売上合計</span>
            <span class={styles.statValue}>
              {formatCurrency(totalRevenue())}
            </span>
          </div>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>会計件数</span>
            <span class={styles.statValue}>{checkCount()}件</span>
          </div>
          <div class={styles.statCard}>
            <span class={styles.statLabel}>平均単価</span>
            <span class={styles.statValue}>
              {formatCurrency(averagePerCheck())}
            </span>
          </div>
        </div>

        <ul class={styles.methodBreakdown} aria-label="支払い方法別内訳">
          <For each={methodTotals()}>
            {(entry) => (
              <li class={styles.methodBreakdownItem}>
                <span class={styles.methodBreakdownLabel}>{entry.label}</span>
                <span class={styles.methodBreakdownAmount}>
                  {formatCurrency(entry.amount)}
                </span>
              </li>
            )}
          </For>
        </ul>

        <Show
          when={payments().length > 0}
          fallback={
            <div class={styles.empty}>
              <p>この日の会計はありません</p>
            </div>
          }
        >
          <ul class={styles.checkList} aria-label="会計一覧">
            <For each={payments()}>
              {(payment) => (
                <li
                  class={`${styles.checkItem} ${payment.voided_at !== null ? styles.checkItemVoided : ""}`}
                >
                  <button
                    type="button"
                    class={styles.checkHeader}
                    onClick={() => toggleExpanded(payment.id)}
                    aria-expanded={expanded().has(payment.id)}
                  >
                    <span class={styles.checkTime}>
                      {formatTime(payment.paid_at)}
                    </span>
                    <span class={styles.checkSeat}>{payment.seat_name}</span>
                    <Show when={payment.voided_at !== null}>
                      <StatusBadge tone="danger">取消済み</StatusBadge>
                    </Show>
                    <span class={styles.checkMethod}>
                      {METHOD_LABELS[payment.method]}
                    </span>
                    <span class={styles.checkTotal}>
                      <Show when={payment.discount_amount > 0}>
                        <span class={styles.checkTotalOriginal}>
                          {formatCurrency(itemsTotal(payment))}
                        </span>
                      </Show>
                      {formatCurrency(payment.total_amount)}
                    </span>
                  </button>
                  <Show when={expanded().has(payment.id)}>
                    <ul class={styles.itemList}>
                      <For each={payment.items}>
                        {(item) => (
                          <li
                            class={`${styles.item} ${item.status === "cancelled" ? styles.itemCancelled : ""}`}
                          >
                            <span class={styles.itemName}>
                              {item.name_snapshot}
                            </span>
                            <span class={styles.itemQty}>
                              × {item.quantity}
                            </span>
                            <span class={styles.itemPrice}>
                              {formatCurrency(
                                item.unit_price_snapshot * item.quantity,
                              )}
                            </span>
                          </li>
                        )}
                      </For>
                      <Show when={payment.discount_amount > 0}>
                        <li class={styles.discountItem}>
                          <span class={styles.itemName}>
                            割引
                            {payment.discount_reason
                              ? `（${payment.discount_reason}）`
                              : ""}
                          </span>
                          <span class={styles.itemPrice}>
                            -{formatCurrency(payment.discount_amount)}
                          </span>
                        </li>
                      </Show>
                    </ul>

                    <Show
                      when={payment.voided_at !== null}
                      fallback={
                        <div class={styles.voidSection}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-expanded={voidReasonOpen().has(payment.id)}
                            disabled={voiding().has(payment.id)}
                            onClick={() => toggleVoidReasonOpen(payment.id)}
                          >
                            {voidReasonOpen().has(payment.id)
                              ? "取消を取りやめる"
                              : "この支払いを取り消す"}
                          </Button>
                          <Show when={voidReasonOpen().has(payment.id)}>
                            <div class={styles.voidFields}>
                              <Field
                                id={`void-reason-${payment.id}`}
                                label="取消理由"
                                value={voidReasonFor(payment.id)}
                                disabled={voiding().has(payment.id)}
                                onInput={(e) =>
                                  setVoidReason(
                                    payment.id,
                                    e.currentTarget.value,
                                  )
                                }
                              />
                              <ConfirmDialog
                                triggerLabel="取消を確定"
                                triggerVariant="danger"
                                triggerSize="sm"
                                triggerDisabled={
                                  voidReasonFor(payment.id).trim() === "" ||
                                  voiding().has(payment.id)
                                }
                                title="支払いを取り消しますか？"
                                description={`${payment.seat_name}・${formatCurrency(payment.total_amount)}を取り消します。取り消すと会計待ちの状態に戻り、売上から除外されます。`}
                                confirmLabel="取り消す"
                                onConfirm={() => handleVoid(payment.id)}
                              />
                            </div>
                          </Show>
                        </div>
                      }
                    >
                      <p class={styles.voidedNote}>
                        取消理由：{payment.void_reason}
                      </p>
                    </Show>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
