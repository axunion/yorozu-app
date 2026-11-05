import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { useStoreInfo } from "./AdminGuard";
import styles from "./OwnerOnly.module.css";

/**
 * Wraps a screen whose API is owner-gated. A staff session would otherwise
 * render the screen's empty forms next to the API's 403, which reads as an
 * empty menu rather than a permission boundary.
 */
export default function OwnerOnly(props: { children: JSX.Element }) {
  const store = useStoreInfo();
  return (
    <Show
      when={store.role === "owner"}
      fallback={
        <p class={styles.notice}>この画面はオーナーのみ利用できます。</p>
      }
    >
      {props.children}
    </Show>
  );
}
