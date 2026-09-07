import { Card } from "@yorozu/ui";
import styles from "./NotEnabled.module.css";

/**
 * Shown when the signed-in store has no active shift subscription. This is
 * not an error the person can fix by retrying or logging in again, so it gets
 * a screen of its own rather than an alert.
 */
export default function NotEnabled() {
  return (
    <main class={styles.wrapper}>
      <Card title="シフト管理は未契約です" class={styles.card}>
        <p class={styles.body}>
          この店舗ではシフト管理をご利用いただけません。ご利用をご希望の場合は、
          オーナーの方からお問い合わせください。
        </p>
      </Card>
    </main>
  );
}
