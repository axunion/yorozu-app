import { Button, ErrorAlert } from "@yorozu/ui";
import { createSignal, Show } from "solid-js";
import styles from "./CheckoutBar.module.css";
import type { Order } from "./OrderScreen";

export default function CheckoutBar(props: {
  order: Order | null;
  onRequestPayment: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const [requesting, setRequesting] = createSignal(false);
  const [error, setError] = createSignal("");

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
    <Show when={props.order && props.order.items.length > 0}>
      <div class={styles.bar}>
        <Show when={error()}>
          <ErrorAlert>{error()}</ErrorAlert>
        </Show>

        <Show
          when={props.order?.status === "payment_requested"}
          fallback={
            <Button
              variant="success"
              fullWidth
              class={styles.payButton}
              onClick={handleRequestPayment}
              disabled={requesting()}
            >
              {requesting() ? "送信中..." : "会計をお願いする"}
            </Button>
          }
        >
          <p class={styles.paymentRequestedMsg} aria-live="polite">
            会計をお待ちください。スタッフが参ります。
          </p>
        </Show>
      </div>
    </Show>
  );
}
