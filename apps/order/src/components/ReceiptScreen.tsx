import { apiFetch } from "@yorozu/core/client";
import { ErrorAlert } from "@yorozu/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import styles from "./ReceiptScreen.module.css";

type ReceiptItemOption = {
  id: string;
  name_snapshot: string;
  group_name_snapshot: string;
  price_delta_snapshot: number;
};

type ReceiptItem = {
  id: string;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  status: "ordered" | "served" | "cancelled";
  options: ReceiptItemOption[];
  note: string | null;
};

type TaxBucket = {
  rate: number;
  taxable_amount: number;
  tax_amount: number;
};

type Receipt = {
  order_id: string;
  store_name: string;
  seat_name: string;
  items: ReceiptItem[];
  items_total: number;
  discount_amount: number;
  discount_reason: string | null;
  total_amount: number;
  tax_breakdown: TaxBucket[];
  method: "cash" | "card" | "qr";
  paid_at: number;
};

const METHOD_LABELS: Record<Receipt["method"], string> = {
  cash: "現金",
  card: "カード",
  qr: "QR決済",
};

function lineTotal(item: ReceiptItem): number {
  const optionDelta = item.options.reduce(
    (sum, option) => sum + option.price_delta_snapshot,
    0,
  );
  return (item.unit_price_snapshot + optionDelta) * item.quantity;
}

const formatCurrency = (amount: number) => `¥${amount.toLocaleString()}`;

const formatPaidAt = (ms: number) =>
  new Date(ms).toLocaleString("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  });

export default function ReceiptScreen(props: {
  seatToken: string;
  orderId: string;
}) {
  const [receipt, setReceipt] = createSignal<Receipt | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");

  onMount(async () => {
    const result = await apiFetch<Receipt>(
      `/api/order/${props.seatToken}/receipt/${props.orderId}`,
    );
    if (result.ok && result.data) {
      setReceipt(result.data);
    } else {
      setError(result.message ?? "レシートが見つかりません。");
    }
    setLoading(false);
  });

  return (
    <main class={styles.main}>
      <Show when={loading()}>
        <p class={styles.loading} aria-live="polite">
          読み込み中...
        </p>
      </Show>

      <Show when={!loading() && error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <Show when={!loading() && receipt()}>
        {(r) => (
          <article class={styles.receipt}>
            <h1 class={styles.storeName}>{r().store_name}</h1>
            <p class={styles.meta}>{r().seat_name}</p>
            <p class={styles.meta}>{formatPaidAt(r().paid_at)}</p>
            <p class={styles.meta}>{METHOD_LABELS[r().method]}</p>

            <ul class={styles.items}>
              <For each={r().items}>
                {(item) => (
                  <li
                    class={`${styles.item} ${item.status === "cancelled" ? styles.itemCancelled : ""}`}
                  >
                    <div class={styles.itemRow}>
                      <span class={styles.itemName}>{item.name_snapshot}</span>
                      <span class={styles.itemQty}>× {item.quantity}</span>
                      <span class={styles.itemPrice}>
                        {formatCurrency(lineTotal(item))}
                      </span>
                    </div>
                    <Show when={item.options.length > 0}>
                      <ul class={styles.optionList}>
                        <For each={item.options}>
                          {(option) => (
                            <li class={styles.optionItem}>
                              {option.name_snapshot}
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                    <Show when={item.note}>
                      <p class={styles.itemNote}>{item.note}</p>
                    </Show>
                  </li>
                )}
              </For>
            </ul>

            <div class={styles.summary}>
              <div class={styles.summaryRow}>
                <span>小計</span>
                <span>{formatCurrency(r().items_total)}</span>
              </div>
              <Show when={r().discount_amount > 0}>
                <div class={styles.summaryRow}>
                  <span>
                    割引
                    {r().discount_reason ? `（${r().discount_reason}）` : ""}
                  </span>
                  <span>-{formatCurrency(r().discount_amount)}</span>
                </div>
              </Show>
              <div class={`${styles.summaryRow} ${styles.summaryTotal}`}>
                <span>合計</span>
                <span>{formatCurrency(r().total_amount)}</span>
              </div>
            </div>

            <ul class={styles.taxBreakdown}>
              <For each={r().tax_breakdown}>
                {(bucket) => (
                  <li class={styles.taxRow}>
                    <span>{bucket.rate}%対象</span>
                    <span>{formatCurrency(bucket.taxable_amount)}</span>
                    <span>(内消費税 {formatCurrency(bucket.tax_amount)})</span>
                  </li>
                )}
              </For>
            </ul>
          </article>
        )}
      </Show>
    </main>
  );
}
