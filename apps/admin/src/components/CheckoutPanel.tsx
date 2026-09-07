import { apiFetch, jsonFetch } from "@yorozu/core/client";
import { Button, ErrorAlert, Field } from "@yorozu/ui";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import styles from "./CheckoutPanel.module.css";
import StatusBadge from "./StatusBadge";

type CheckoutItemOption = {
  id: string;
  name_snapshot: string;
  group_name_snapshot: string;
  price_delta_snapshot: number;
};

type CheckoutItem = {
  id: string;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  options: CheckoutItemOption[];
  note: string | null;
  status: string;
  created_at: number;
};

function lineTotal(item: CheckoutItem): number {
  const optionDelta = item.options.reduce(
    (sum, option) => sum + option.price_delta_snapshot,
    0,
  );
  return (item.unit_price_snapshot + optionDelta) * item.quantity;
}

/** Formats a price delta as a signed yen amount, or "" when it's 0. */
function formatDelta(delta: number): string {
  if (delta === 0) return "";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}¥${Math.abs(delta).toLocaleString("ja-JP")}`;
}

type PendingOrder = {
  id: string;
  seat_name: string;
  status: string;
  items: CheckoutItem[];
  total: number;
  created_at: number;
};

type PaymentResult = {
  id: string;
  order_id: string;
  total_amount: number;
  method: string;
  paid_at: number;
};

type PaymentMethod = "cash" | "card" | "qr";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "現金" },
  { value: "card", label: "カード" },
  { value: "qr", label: "QR決済" },
];

type Discount = { amount: number; reason: string };
const NO_DISCOUNT: Discount = { amount: 0, reason: "" };

export default function CheckoutPanel() {
  const [orders, setOrders] = createSignal<PendingOrder[]>([]);
  const [pollError, setPollError] = createSignal("");
  const [actionError, setActionError] = createSignal("");
  const [processing, setProcessing] = createSignal<Set<string>>(new Set());
  const [methodByOrder, setMethodByOrder] = createSignal<
    Map<string, PaymentMethod>
  >(new Map());

  const methodFor = (orderId: string): PaymentMethod =>
    methodByOrder().get(orderId) ?? "cash";

  const setMethodFor = (orderId: string, method: PaymentMethod) => {
    setMethodByOrder((prev) => new Map(prev).set(orderId, method));
  };

  // Discount entry is opt-in per order (deliberate extra tap, not part of
  // the default flow) and hidden by default to discourage casual misuse.
  const [discountOpen, setDiscountOpen] = createSignal<Set<string>>(new Set());
  const [discountByOrder, setDiscountByOrder] = createSignal<
    Map<string, Discount>
  >(new Map());

  const discountFor = (orderId: string): Discount =>
    discountByOrder().get(orderId) ?? NO_DISCOUNT;

  const discountReasonMissing = (orderId: string): boolean => {
    const discount = discountFor(orderId);
    return discount.amount > 0 && discount.reason.trim() === "";
  };

  const setDiscount = (orderId: string, discount: Partial<Discount>) => {
    setDiscountByOrder((prev) =>
      new Map(prev).set(orderId, { ...discountFor(orderId), ...discount }),
    );
  };

  const toggleDiscountOpen = (orderId: string) => {
    setDiscountOpen((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
        setDiscount(orderId, NO_DISCOUNT);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  async function loadPending() {
    const result = await apiFetch<PendingOrder[]>("/api/payments/pending");
    if (result.ok && result.data) {
      setOrders(result.data);
      setPollError("");
      // Prune method/discount selections for orders that left the pending
      // list (checked out or reopened), so these maps don't grow unbounded
      // across a long shift with many turnovers.
      const stillPendingIds = new Set(result.data.map((o) => o.id));
      setMethodByOrder((prev) => {
        const next = new Map(
          [...prev].filter(([orderId]) => stillPendingIds.has(orderId)),
        );
        return next;
      });
      setDiscountByOrder((prev) => {
        const next = new Map(
          [...prev].filter(([orderId]) => stillPendingIds.has(orderId)),
        );
        return next;
      });
      setDiscountOpen((prev) => {
        const next = new Set(
          [...prev].filter((orderId) => stillPendingIds.has(orderId)),
        );
        return next;
      });
    } else {
      setOrders([]);
      setPollError(result.message ?? "伝票の取得に失敗しました。");
    }
  }

  onMount(() => {
    loadPending();
    const timerId = setInterval(loadPending, 5000);
    onCleanup(() => clearInterval(timerId));
  });

  const handleCheckout = async (orderId: string) => {
    setActionError("");
    setProcessing((prev) => new Set([...prev, orderId]));
    try {
      const discount = discountFor(orderId);
      const result = await jsonFetch<PaymentResult>("/api/payments", "POST", {
        order_id: orderId,
        method: methodFor(orderId),
        ...(discount.amount > 0
          ? {
              discount_amount: discount.amount,
              discount_reason: discount.reason,
            }
          : {}),
      });
      if (!result.ok) {
        setActionError(result.message ?? "会計処理に失敗しました。");
        return;
      }
      await loadPending();
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const handleReopen = async (orderId: string) => {
    setActionError("");
    setProcessing((prev) => new Set([...prev, orderId]));
    try {
      const result = await apiFetch(`/api/admin/orders/${orderId}/reopen`, {
        method: "PATCH",
      });
      if (!result.ok) {
        setActionError(result.message ?? "席への差し戻しに失敗しました。");
        return;
      }
      await loadPending();
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  const formatCurrency = (amount: number) =>
    `¥${amount.toLocaleString("ja-JP")}`;

  return (
    <div class={styles.checkoutPanel}>
      <Show when={actionError()}>
        <ErrorAlert>{actionError()}</ErrorAlert>
      </Show>
      <Show when={pollError() && !actionError()}>
        <ErrorAlert>{pollError()}</ErrorAlert>
      </Show>

      <Show when={orders().length === 0 && !pollError() && !actionError()}>
        <div class={styles.checkoutPanelEmpty}>
          <p>会計待ちの伝票はありません</p>
        </div>
      </Show>

      <div class={styles.checkoutList}>
        <For each={orders()}>
          {(order) => (
            <article class={styles.checkoutCard}>
              <div class={styles.checkoutCardHeader}>
                <span class={styles.checkoutSeatName}>{order.seat_name}</span>
                <StatusBadge tone="warning">会計要求中</StatusBadge>
                <span class={styles.checkoutTotal}>
                  <Show
                    when={discountFor(order.id).amount > 0}
                    fallback={formatCurrency(order.total)}
                  >
                    <span class={styles.checkoutTotalOriginal}>
                      {formatCurrency(order.total)}
                    </span>
                    {formatCurrency(order.total - discountFor(order.id).amount)}
                  </Show>
                </span>
              </div>

              <ul class={styles.checkoutItems}>
                <For each={order.items}>
                  {(item) => (
                    <li class={styles.checkoutItem}>
                      <div class={styles.checkoutItemRow}>
                        <span class={styles.checkoutItemName}>
                          {item.name_snapshot}
                        </span>
                        <span class={styles.checkoutItemQty}>
                          × {item.quantity}
                        </span>
                        <span class={styles.checkoutItemPrice}>
                          {formatCurrency(lineTotal(item))}
                        </span>
                      </div>
                      <Show when={item.options.length > 0}>
                        <ul class={styles.checkoutItemOptions}>
                          <For each={item.options}>
                            {(option) => (
                              <li class={styles.checkoutItemOption}>
                                {option.name_snapshot}
                                <Show when={option.price_delta_snapshot !== 0}>
                                  {" "}
                                  ({formatDelta(option.price_delta_snapshot)})
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                      <Show when={item.note}>
                        <p class={styles.checkoutItemNote}>{item.note}</p>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>

              <fieldset class={styles.checkoutMethodGroup}>
                <legend class={styles.visuallyHidden}>支払い方法</legend>
                <For each={PAYMENT_METHODS}>
                  {(method) => (
                    <Button
                      type="button"
                      variant={
                        methodFor(order.id) === method.value
                          ? "primary"
                          : "secondary"
                      }
                      size="sm"
                      aria-pressed={methodFor(order.id) === method.value}
                      disabled={processing().has(order.id)}
                      onClick={() => setMethodFor(order.id, method.value)}
                    >
                      {method.label}
                    </Button>
                  )}
                </For>
              </fieldset>

              <div class={styles.checkoutDiscount}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={discountOpen().has(order.id)}
                  disabled={processing().has(order.id)}
                  onClick={() => toggleDiscountOpen(order.id)}
                >
                  {discountOpen().has(order.id)
                    ? "割引を取り消す"
                    : "割引を追加"}
                </Button>
                <Show when={discountOpen().has(order.id)}>
                  <div class={styles.checkoutDiscountFields}>
                    <Field
                      id={`discount-amount-${order.id}`}
                      label="割引額 (円)"
                      type="number"
                      min="0"
                      max={order.total}
                      inputMode="numeric"
                      value={discountFor(order.id).amount || ""}
                      disabled={processing().has(order.id)}
                      onInput={(e) =>
                        setDiscount(order.id, {
                          amount: Math.min(
                            order.total,
                            Math.max(0, Number(e.currentTarget.value) || 0),
                          ),
                        })
                      }
                    />
                    <Field
                      id={`discount-reason-${order.id}`}
                      label="理由"
                      value={discountFor(order.id).reason}
                      disabled={processing().has(order.id)}
                      error={
                        discountReasonMissing(order.id)
                          ? "理由を入力してください"
                          : undefined
                      }
                      onInput={(e) =>
                        setDiscount(order.id, {
                          reason: e.currentTarget.value,
                        })
                      }
                    />
                  </div>
                </Show>
              </div>

              <div class={styles.checkoutCardFooter}>
                <Button
                  variant="secondary"
                  disabled={processing().has(order.id)}
                  onClick={() => handleReopen(order.id)}
                >
                  {processing().has(order.id) ? "処理中..." : "席に戻す"}
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    processing().has(order.id) ||
                    discountReasonMissing(order.id)
                  }
                  onClick={() => handleCheckout(order.id)}
                >
                  {processing().has(order.id) ? "処理中..." : "会計完了"}
                </Button>
              </div>
            </article>
          )}
        </For>
      </div>
    </div>
  );
}
