import type { LaborWarning, LaborWarningCode } from "@yorozu/core";
import { Card } from "@yorozu/ui";
import { For, Show } from "solid-js";
import { formatWorkDate } from "../lib/format";
import styles from "./WarningsPanel.module.css";

const MESSAGE: Record<LaborWarningCode, string> = {
  DAILY_OVER_8H: "1日8時間を超えています",
  WEEKLY_OVER_40H: "週40時間を超えています",
  BREAK_REQUIRED_45: "6時間超の勤務に45分以上の休憩が必要です",
  BREAK_REQUIRED_60: "8時間超の勤務に60分以上の休憩が必要です",
  NO_REST_DAY: "7日連続の勤務になっています",
  OVER_WEEKLY_CAP: "本人の上限時間を超えています",
  MINOR_LATE_NIGHT: "18歳未満が深夜帯に入っています",
};

/**
 * Advisory only — nothing here blocks publishing. The wording says
 * "確認してください", never "エラー", because a manager may have a reason.
 */
export default function WarningsPanel(props: {
  warnings: LaborWarning[];
  nameOf: (memberId: string) => string;
}) {
  return (
    <Card title="確認してください" class={styles.panel}>
      <Show
        when={props.warnings.length > 0}
        fallback={<p class={styles.none}>気になる点はありません。</p>}
      >
        <ul class={styles.list}>
          <For each={props.warnings}>
            {(warning) => (
              <li class={styles.item}>
                <span class={styles.who}>
                  {props.nameOf(warning.member_id)}
                </span>
                <Show when={warning.work_date}>
                  {(date) => (
                    <span class={styles.when}>{formatWorkDate(date())}</span>
                  )}
                </Show>
                <span>{MESSAGE[warning.code]}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Card>
  );
}
