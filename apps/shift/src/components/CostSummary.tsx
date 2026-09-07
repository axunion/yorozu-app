import type { LaborCost } from "@yorozu/core";
import { Card } from "@yorozu/ui";
import { createMemo, For, Show } from "solid-js";
import { formatYen } from "../lib/format";
import styles from "./CostSummary.module.css";

/**
 * A rough total, not payroll. A member with no recorded wage is named rather
 * than counted as free, so nobody reads the total as complete when it is not.
 */
export default function CostSummary(props: {
  cost: LaborCost;
  nameOf: (memberId: string) => string;
}) {
  const members = createMemo(() =>
    Object.entries(props.cost.per_member).sort((a, b) => b[1] - a[1]),
  );

  return (
    <Card title="人件費の目安" class={styles.panel}>
      <p class={styles.total}>{formatYen(props.cost.total)}</p>
      <Show when={props.cost.unpriced_member_ids.length > 0}>
        <p class={styles.unpriced}>
          時給が未登録のため未計上：
          {props.cost.unpriced_member_ids
            .map((id) => props.nameOf(id))
            .join("、")}
        </p>
      </Show>
      <Show when={members().length > 0}>
        <ul class={styles.list}>
          <For each={members()}>
            {([memberId, amount]) => (
              <li class={styles.item}>
                <span>{props.nameOf(memberId)}</span>
                <span class={styles.amount}>{formatYen(amount)}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Card>
  );
}
