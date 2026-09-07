import { apiFetch } from "@yorozu/core/client";
import { Button, ConfirmDialog, ErrorAlert } from "@yorozu/ui";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  createHighlightTracker,
  formatElapsed,
  loadSoundPreference,
  playAlertBeep,
  saveSoundPreference,
} from "../lib/orderAlerts";
import styles from "./OrderBoard.module.css";
import StatusBadge from "./StatusBadge";

type OrderItemOption = {
  id: string;
  name_snapshot: string;
  group_name_snapshot: string;
  price_delta_snapshot: number;
};

type OrderItem = {
  id: string;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  options: OrderItemOption[];
  note: string | null;
  status: "ordered" | "served" | "cancelled";
  created_at: number;
};

function lineTotal(item: OrderItem): number {
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

type AdminOrder = {
  id: string;
  seat_name: string;
  status: "open" | "payment_requested";
  items: OrderItem[];
  total: number;
  created_at: number;
};

const AGE_WARNING_MS = 10 * 60 * 1000;
const AGE_ALERT_MS = 20 * 60 * 1000;

/**
 * The oldest still-`ordered` item's created_at, or null if every item is
 * `served`/`cancelled` — an order with nothing left waiting is "done
 * waiting" regardless of how long ago it opened.
 */
function oldestUnservedCreatedAt(order: AdminOrder): number | null {
  const createdTimes = order.items
    .filter((item) => item.status === "ordered")
    .map((item) => item.created_at);
  return createdTimes.length > 0 ? Math.min(...createdTimes) : null;
}

type AgeTier = "normal" | "warning" | "alert";

function ageTier(ageMs: number): AgeTier {
  if (ageMs >= AGE_ALERT_MS) return "alert";
  if (ageMs >= AGE_WARNING_MS) return "warning";
  return "normal";
}

/** Formats an age in milliseconds as whole minutes, e.g. "12分". */
function formatAge(ageMs: number): string {
  return `${Math.floor(ageMs / 60_000)}分`;
}

type AdminCall = {
  id: string;
  seat_name: string;
  status: "open" | "resolved";
  created_at: number;
  resolved_at: number | null;
};

const BASE_TITLE = "Order Manager — Admin";

export default function OrderBoard() {
  const [orders, setOrders] = createSignal<AdminOrder[]>([]);
  const [calls, setCalls] = createSignal<AdminCall[]>([]);
  const [error, setError] = createSignal("");
  // Separate from `error` so the two independently-polled loaders
  // (loadOrders, loadCalls) can't clobber each other's error state — e.g.
  // orders succeeding right after calls failed must not silently clear the
  // calls failure, and vice versa.
  const [callsError, setCallsError] = createSignal("");
  const [pendingActions, setPendingActions] = createSignal<Set<string>>(
    new Set(),
  );
  const [soundEnabled, setSoundEnabled] = createSignal(loadSoundPreference());
  const { highlightedIds, highlight } = createHighlightTracker();

  // Not signals: only used inside loadOrders/loadCalls to diff polls, never
  // read in JSX.
  let watermark = -Infinity;
  let hasLoadedOnce = false;
  let callWatermark = -Infinity;
  let hasLoadedCallsOnce = false;

  function triggerAlert(ids: Set<string>) {
    if (ids.size === 0) return;
    highlight(ids);
    if (soundEnabled()) {
      playAlertBeep();
    }
  }

  async function loadOrders() {
    const result = await apiFetch<AdminOrder[]>("/api/admin/orders");
    if (result.ok && result.data) {
      const items = result.data.flatMap((o) => o.items);
      if (!hasLoadedOnce) {
        // Initial load: set the watermark silently, no alert.
        watermark = items.reduce(
          (max, i) => Math.max(max, i.created_at),
          watermark,
        );
        hasLoadedOnce = true;
      } else {
        const newOrderIds = new Set(
          result.data
            .filter((o) => o.items.some((i) => i.created_at > watermark))
            .map((o) => o.id),
        );
        watermark = items.reduce(
          (max, i) => Math.max(max, i.created_at),
          watermark,
        );
        triggerAlert(newOrderIds);
      }
      setOrders(result.data);
      setError("");
    } else {
      setOrders([]);
      setError(result.message ?? "注文の取得に失敗しました。");
    }
  }

  async function loadCalls() {
    const result = await apiFetch<AdminCall[]>("/api/admin/calls");
    if (result.ok && result.data) {
      if (!hasLoadedCallsOnce) {
        // Initial load: set the watermark silently, no alert.
        callWatermark = result.data.reduce(
          (max, c) => Math.max(max, c.created_at),
          callWatermark,
        );
        hasLoadedCallsOnce = true;
      } else {
        const newCallIds = new Set(
          result.data
            .filter((c) => c.created_at > callWatermark)
            .map((c) => c.id),
        );
        callWatermark = result.data.reduce(
          (max, c) => Math.max(max, c.created_at),
          callWatermark,
        );
        triggerAlert(newCallIds);
      }
      setCalls(result.data);
      setCallsError("");
    } else {
      setCalls([]);
      setCallsError(result.message ?? "呼び出しの取得に失敗しました。");
    }
  }

  onMount(() => {
    loadOrders();
    loadCalls();
    const orderTimerId = setInterval(loadOrders, 5000);
    const callTimerId = setInterval(loadCalls, 5000);
    onCleanup(() => {
      clearInterval(orderTimerId);
      clearInterval(callTimerId);
    });
    onCleanup(() => {
      document.title = BASE_TITLE;
    });
  });

  const unservedCount = createMemo(() =>
    orders().reduce(
      (sum, o) => sum + o.items.filter((i) => i.status === "ordered").length,
      0,
    ),
  );

  createEffect(() => {
    const count = unservedCount();
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  });

  const toggleSound = () => {
    const next = !soundEnabled();
    setSoundEnabled(next);
    saveSoundPreference(next);
    if (next) {
      // The toggle-on click doubles as the audio-unlocking user gesture.
      playAlertBeep();
    }
  };

  const runItemAction = async (
    itemId: string,
    path: string,
    failureMessage: string,
  ) => {
    setPendingActions((prev) => new Set([...prev, itemId]));
    try {
      const result = await apiFetch(path, { method: "PATCH" });
      if (!result.ok) {
        setError(result.message ?? failureMessage);
        return;
      }
      await loadOrders();
    } finally {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleServe = (itemId: string) =>
    runItemAction(
      itemId,
      `/api/admin/orders/items/${itemId}/serve`,
      "提供済みマークに失敗しました。",
    );

  const handleUnserve = (itemId: string) =>
    runItemAction(
      itemId,
      `/api/admin/orders/items/${itemId}/unserve`,
      "提供取消に失敗しました。",
    );

  const handleVoidItem = (itemId: string) =>
    runItemAction(
      itemId,
      `/api/admin/orders/items/${itemId}/cancel`,
      "明細の取消に失敗しました。",
    );

  const handleCancelOrder = async (orderId: string) => {
    const result = await apiFetch(`/api/admin/orders/${orderId}/cancel`, {
      method: "PATCH",
    });
    if (!result.ok) {
      setError(result.message ?? "注文のキャンセルに失敗しました。");
      return;
    }
    await loadOrders();
  };

  const handleResolveCall = async (callId: string) => {
    setPendingActions((prev) => new Set([...prev, callId]));
    try {
      const result = await apiFetch(`/api/admin/calls/${callId}/resolve`, {
        method: "PATCH",
      });
      if (!result.ok) {
        setError(result.message ?? "呼び出しの解決に失敗しました。");
        return;
      }
      await loadCalls();
    } finally {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(callId);
        return next;
      });
    }
  };

  const formatCurrency = (amount: number) =>
    `¥${amount.toLocaleString("ja-JP")}`;

  return (
    <div class={styles.orderBoard}>
      <div class={styles.alertControls}>
        <button
          type="button"
          class={styles.soundToggle}
          aria-pressed={soundEnabled()}
          onClick={toggleSound}
        >
          {soundEnabled() ? "🔔 通知音: オン" : "🔕 通知音: オフ"}
        </button>
      </div>

      <Show when={error() || callsError()}>
        <ErrorAlert>{error() || callsError()}</ErrorAlert>
      </Show>

      <Show when={calls().length > 0}>
        <ul class={styles.callBanner}>
          <For each={calls()}>
            {(call) => (
              <li
                class={`${styles.callBannerItem ?? ""} ${highlightedIds().has(call.id) ? (styles.callBannerItemNewAlert ?? "") : ""}`}
              >
                <span class={styles.pulseDot} aria-hidden="true" />
                <span class={styles.callBannerSeatName}>{call.seat_name}</span>
                <span class={styles.callBannerElapsed}>
                  {formatElapsed(call.created_at)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pendingActions().has(call.id)}
                  onClick={() => handleResolveCall(call.id)}
                >
                  {pendingActions().has(call.id) ? "処理中..." : "対応済み"}
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={orders().length === 0 && !error()}>
        <div class={styles.orderBoardEmpty}>
          <p>アクティブな注文はありません</p>
        </div>
      </Show>

      <div class={styles.orderList}>
        {/* Age reads Date.now() fresh per card render rather than ticking
            on its own timer — it advances only because loadOrders() always
            calls setOrders() with freshly-parsed JSON (new object
            references) every 5s poll, which makes <For>'s reference-based
            reconciliation rebuild every card each tick. If a future change
            ever preserves object identity for unchanged orders (e.g. an
            incremental-render optimization), this age would silently
            freeze — re-introduce a dedicated tick if that happens. */}
        <For each={orders()}>
          {(order) => {
            const oldestUnserved = oldestUnservedCreatedAt(order);
            const ageMs =
              oldestUnserved !== null
                ? Math.max(0, Date.now() - oldestUnserved)
                : null;
            const tier = ageMs !== null ? ageTier(ageMs) : null;
            return (
              <article
                class={`${styles.orderCard ?? ""} ${order.status === "payment_requested" ? (styles.orderCardWarning ?? "") : (styles.orderCardAlert ?? "")} ${highlightedIds().has(order.id) ? (styles.orderCardNewAlert ?? "") : ""}`}
              >
                <div class={styles.orderCardHeader}>
                  <Show when={order.status === "open"}>
                    <span class={styles.pulseDot} aria-hidden="true" />
                  </Show>
                  <span class={styles.orderSeatName}>{order.seat_name}</span>
                  <Show when={order.status === "open"}>
                    <StatusBadge tone="alert">新規注文</StatusBadge>
                  </Show>
                  <Show when={order.status === "payment_requested"}>
                    <StatusBadge tone="warning">会計要求中</StatusBadge>
                  </Show>
                  <Show when={ageMs !== null}>
                    <span
                      class={`${styles.orderAge ?? ""} ${tier === "warning" ? (styles.orderAgeWarning ?? "") : ""} ${tier === "alert" ? (styles.orderAgeAlert ?? "") : ""}`}
                    >
                      {formatAge(ageMs ?? 0)}
                    </span>
                  </Show>
                  <span class={styles.orderTotal}>
                    {formatCurrency(order.total)}
                  </span>
                  <ConfirmDialog
                    triggerLabel="注文をキャンセル"
                    triggerVariant="danger"
                    triggerSize="sm"
                    aria-label={`注文をキャンセル ${order.seat_name}`}
                    title="注文のキャンセル"
                    description={`「${order.seat_name}」の注文をキャンセルしますか？明細もすべて取り消されます。この操作は元に戻せません。`}
                    confirmLabel="キャンセルする"
                    onConfirm={() => handleCancelOrder(order.id)}
                  />
                </div>

                <ul class={styles.orderItems}>
                  <For each={order.items}>
                    {(item) => (
                      <li
                        class={`${styles.orderItem ?? ""} ${item.status === "served" ? (styles.orderItemServed ?? "") : ""} ${item.status === "cancelled" ? (styles.orderItemCancelled ?? "") : ""}`}
                      >
                        <div class={styles.orderItemRow}>
                          <span class={styles.orderItemName}>
                            {item.name_snapshot}
                          </span>
                          <span class={styles.orderItemQty}>
                            × {item.quantity}
                          </span>
                          <span class={styles.orderItemPrice}>
                            {formatCurrency(lineTotal(item))}
                          </span>
                          <Show
                            when={item.status !== "cancelled"}
                            fallback={
                              <StatusBadge tone="danger">取消済み</StatusBadge>
                            }
                          >
                            <Show
                              when={item.status === "served"}
                              fallback={
                                <Button
                                  variant="success"
                                  size="sm"
                                  disabled={pendingActions().has(item.id)}
                                  onClick={() => handleServe(item.id)}
                                >
                                  {pendingActions().has(item.id)
                                    ? "処理中..."
                                    : "提供済み"}
                                </Button>
                              }
                            >
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={pendingActions().has(item.id)}
                                onClick={() => handleUnserve(item.id)}
                              >
                                {pendingActions().has(item.id)
                                  ? "処理中..."
                                  : "提供取消"}
                              </Button>
                            </Show>
                            <ConfirmDialog
                              triggerLabel="取消"
                              triggerVariant="danger"
                              triggerSize="sm"
                              aria-label={`明細を取消 ${item.name_snapshot} (${item.id})`}
                              title="明細の取消"
                              description={`「${item.name_snapshot}」を取消しますか？この操作は元に戻せません。`}
                              confirmLabel="取消する"
                              onConfirm={() => handleVoidItem(item.id)}
                            />
                          </Show>
                        </div>
                        <Show when={item.options.length > 0}>
                          <ul class={styles.orderItemOptions}>
                            <For each={item.options}>
                              {(option) => (
                                <li class={styles.orderItemOption}>
                                  {option.name_snapshot}
                                  <Show
                                    when={option.price_delta_snapshot !== 0}
                                  >
                                    {" "}
                                    ({formatDelta(option.price_delta_snapshot)})
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                        <Show when={item.note}>
                          <p class={styles.orderItemNote}>{item.note}</p>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </article>
            );
          }}
        </For>
      </div>
    </div>
  );
}
