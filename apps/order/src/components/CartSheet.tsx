// Namespace import on purpose — see ItemDetailSheet.tsx.
import * as Dialog from "@kobalte/core/dialog";
import { Button, ErrorAlert } from "@yorozu/ui";
import { createSignal, Index, Show } from "solid-js";
import { type CartLine, cartTotal, MAX_LINE_QUANTITY } from "../lib/cart";
import styles from "./CartSheet.module.css";
import QuantityStepper from "./QuantityStepper";

/**
 * Review step before anything reaches the kitchen: the customer sees every
 * line and the total, adjusts quantities, then sends the whole cart at once.
 */
export default function CartSheet(props: {
  lines: CartLine[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetQuantity: (key: string, quantity: number) => void;
  onConfirm: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");

  function close() {
    setError("");
    props.onOpenChange(false);
  }

  async function handleConfirm() {
    setError("");
    setSubmitting(true);
    try {
      const result = await props.onConfirm();
      if (!result.ok) {
        setError(result.message ?? "注文に失敗しました。");
        return;
      }
      close();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) =>
        open ? props.onOpenChange(true) : !submitting() && close()
      }
    >
      <Dialog.Portal>
        <Dialog.Overlay class={styles.overlay} />
        <div class={styles.positioner}>
          <Dialog.Content class={styles.content}>
            <div class={styles.body}>
              <Dialog.Title class={styles.title}>カートの内容</Dialog.Title>
              <Show when={error()}>
                <ErrorAlert>{error()}</ErrorAlert>
              </Show>
              <Show
                when={props.lines.length > 0}
                fallback={<p class={styles.empty}>カートは空です</p>}
              >
                {/* <Index> keeps each row mounted when its quantity changes
                    (the line object is replaced), so the stepper button
                    the customer just pressed keeps focus. */}
                <ul class={styles.lines}>
                  <Index each={props.lines}>
                    {(line) => (
                      <li class={styles.line}>
                        <div class={styles.lineInfo}>
                          <span class={styles.lineName}>{line().name}</span>
                          <Show when={line().option_labels.length > 0}>
                            <span class={styles.lineDetail}>
                              {line().option_labels.join("、")}
                            </span>
                          </Show>
                          <Show when={line().note}>
                            <span class={styles.lineDetail}>{line().note}</span>
                          </Show>
                          <span class={styles.linePrice}>
                            ¥
                            {(
                              line().unit_price * line().quantity
                            ).toLocaleString()}
                          </span>
                        </div>
                        <div class={styles.lineControls}>
                          <QuantityStepper
                            itemName={line().name}
                            quantity={line().quantity}
                            decreaseDisabled={submitting()}
                            increaseDisabled={
                              submitting() ||
                              line().quantity >= MAX_LINE_QUANTITY
                            }
                            onDecrease={() =>
                              props.onSetQuantity(
                                line().key,
                                line().quantity - 1,
                              )
                            }
                            onIncrease={() =>
                              props.onSetQuantity(
                                line().key,
                                line().quantity + 1,
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            class={styles.removeButton}
                            aria-label={`${line().name}をカートから削除`}
                            disabled={submitting()}
                            onClick={() => props.onSetQuantity(line().key, 0)}
                          >
                            削除
                          </Button>
                        </div>
                      </li>
                    )}
                  </Index>
                </ul>
              </Show>
            </div>

            <div class={styles.footer}>
              <div class={styles.total}>
                <span>合計</span>
                <span class={styles.totalAmount}>
                  ¥{cartTotal(props.lines).toLocaleString()}
                </span>
              </div>
              <div class={styles.actions}>
                <Button
                  type="button"
                  variant="secondary"
                  class={styles.actionButton}
                  disabled={submitting()}
                  onClick={close}
                >
                  メニューに戻る
                </Button>
                <Button
                  type="button"
                  class={styles.actionButton}
                  disabled={submitting() || props.lines.length === 0}
                  onClick={handleConfirm}
                >
                  {submitting() ? "送信中..." : "注文を確定"}
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
