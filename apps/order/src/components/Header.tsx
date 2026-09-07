import { Button } from "@yorozu/ui";
import { Show } from "solid-js";
import styles from "./Header.module.css";

export default function Header(props: {
  seatName: string;
  callOpen: boolean;
  onCallStaff: () => void;
}) {
  return (
    <header class={styles.header}>
      <div class={styles.titleGroup}>
        <h1 class={styles.title}>{props.seatName}</h1>
        <p class={styles.subtitle}>セルフオーダー</p>
      </div>
      <div class={styles.callGroup}>
        <Show when={props.callOpen}>
          <p class={styles.callStatus} aria-live="polite">
            呼んでいます
          </p>
        </Show>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          class={styles.callButton}
          onClick={props.onCallStaff}
        >
          スタッフを呼ぶ
        </Button>
      </div>
    </header>
  );
}
