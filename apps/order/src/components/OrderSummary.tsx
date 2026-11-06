import { For, Show } from "solid-js";
import type { Order, OrderItem } from "./OrderScreen";
import styles from "./OrderSummary.module.css";

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
  return `${sign}¥${Math.abs(delta).toLocaleString()}`;
}

export const ORDER_SUMMARY_ID = "order-summary";

export default function OrderSummary(props: { order: Order | null }) {
  return (
    <section class={styles.section} id={ORDER_SUMMARY_ID}>
      <h2 class={styles.heading}>ご注文内容</h2>

      <Show
        when={props.order && props.order.items.length > 0}
        fallback={<p class={styles.empty}>注文がまだありません</p>}
      >
        <ul class={styles.items}>
          <For each={props.order?.items ?? []}>
            {(item) => (
              <li
                class={`${styles.item} ${item.status === "cancelled" ? styles.itemCancelled : ""}`}
              >
                <div class={styles.itemRow}>
                  <span class={styles.itemName}>{item.name_snapshot}</span>
                  <span class={styles.itemQty}>× {item.quantity}</span>
                  <span class={styles.itemPrice}>
                    ¥{lineTotal(item).toLocaleString()}
                  </span>
                  <Show
                    when={item.status === "cancelled"}
                    fallback={
                      <span
                        class={`${styles.itemStatusLabel} ${item.status === "served" ? styles.itemStatusLabelServed : ""}`}
                      >
                        {item.status === "served" ? "提供済み" : "注文済み"}
                      </span>
                    }
                  >
                    <span class={styles.itemCancelledLabel}>取消済み</span>
                  </Show>
                </div>
                <Show when={item.options.length > 0}>
                  <ul class={styles.optionList}>
                    <For each={item.options}>
                      {(option) => (
                        <li class={styles.optionItem}>
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
                  <p class={styles.itemNote}>{item.note}</p>
                </Show>
              </li>
            )}
          </For>
        </ul>

        <div class={styles.total}>
          <span>合計</span>
          <span class={styles.totalAmount}>
            ¥{(props.order?.total ?? 0).toLocaleString()}
          </span>
        </div>
      </Show>
    </section>
  );
}
