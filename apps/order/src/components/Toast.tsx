import { Show } from "solid-js";
import styles from "./Toast.module.css";

export type ToastMessage = { text: string; tone: "success" | "warning" };

/**
 * Short-lived feedback shown just above the bottom bar, so it is visible
 * wherever the customer has scrolled. The live region stays mounted so
 * screen readers announce each new message.
 */
export default function Toast(props: { message: ToastMessage | null }) {
  return (
    <div class={styles.region} role="status" aria-live="polite">
      <Show when={props.message}>
        {(message) => (
          <p
            class={`${styles.toast} ${message().tone === "warning" ? styles.warning : ""}`}
          >
            {message().text}
          </p>
        )}
      </Show>
    </div>
  );
}
