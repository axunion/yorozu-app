import { Button, ErrorAlert } from "@yorozu/ui";
import { createSignal, Show } from "solid-js";
import styles from "./BottomBar.module.css";
import type { Order } from "./OrderScreen";
import Toast, { type ToastMessage } from "./Toast";

/**
 * Fixed to the bottom of the viewport so the cart, the running total and the
 * bill request stay reachable wherever the customer has scrolled. The toast
 * is anchored to the bar's top edge, so it clears the bar whatever its
 * height.
 */
export default function BottomBar(props: {
  order: Order | null;
  cartCount: number;
  cartTotal: number;
  toast: ToastMessage | null;
  onOpenCart: () => void;
  onShowOrder: () => void;
  onRequestPayment: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const [requesting, setRequesting] = createSignal(false);
  const [error, setError] = createSignal("");

  const hasOrder = () => (props.order?.items.length ?? 0) > 0;
  // While the cart holds unsent items the CTA opens the cart instead of
  // requesting the bill, so part of the order can't be left on the phone.
  const cartMode = () => props.cartCount > 0;

  async function handleRequestPayment() {
    setError("");
    setRequesting(true);
    try {
      const result = await props.onRequestPayment();
      if (!result.ok) {
        setError(result.message ?? "エラーが発生しました。");
      }
    } finally {
      setRequesting(false);
    }
  }

  return (
    <Show when={hasOrder() || cartMode() || props.toast}>
      <div class={styles.bar}>
        <Toast message={props.toast} />

        <Show when={error()}>
          <ErrorAlert>{error()}</ErrorAlert>
        </Show>

        <Show when={hasOrder()}>
          <button
            type="button"
            class={styles.orderedLink}
            onClick={() => props.onShowOrder()}
          >
            <span>注文済み ¥{(props.order?.total ?? 0).toLocaleString()}</span>
            <span class={styles.orderedLinkAction}>内容を見る</span>
          </button>
        </Show>

        <Show
          when={props.order?.status !== "payment_requested"}
          fallback={
            <p class={styles.paymentRequestedMsg} aria-live="polite">
              会計をお待ちください。スタッフが参ります。
            </p>
          }
        >
          {/* One button whose role changes, rather than two swapped by
              <Show>: the cart sheet returns focus here when it closes, and
              a successful 注文を確定 empties the cart while it is open. */}
          <Show when={hasOrder() || cartMode()}>
            <Button
              variant={cartMode() ? "primary" : "success"}
              fullWidth
              class={styles.ctaButton}
              onClick={() =>
                cartMode() ? props.onOpenCart() : handleRequestPayment()
              }
              disabled={!cartMode() && requesting()}
            >
              <Show
                when={cartMode()}
                fallback={requesting() ? "送信中..." : "会計をお願いする"}
              >
                カートを見る（{props.cartCount}点 ¥
                {props.cartTotal.toLocaleString()}）
              </Show>
            </Button>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
