import { A } from "@solidjs/router";
import type { SchedulePeriodResponse, ShiftResponse } from "@yorozu/core";
import { workedMinutes } from "@yorozu/core";
import { apiFetch } from "@yorozu/core/client";
import { Card, ErrorAlert } from "@yorozu/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import ShiftLayout from "../layouts/ShiftLayout";
import { formatMinutes, formatWorkDate } from "../lib/format";
import styles from "./MySchedulePage.module.css";

type Schedule = {
  period: SchedulePeriodResponse;
  published: boolean;
  shifts: ShiftResponse[];
};

export default function MySchedulePage() {
  const [periods, setPeriods] = createSignal<SchedulePeriodResponse[]>([]);
  const [schedule, setSchedule] = createSignal<Schedule | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    const result =
      await apiFetch<SchedulePeriodResponse[]>("/api/shift/periods");
    if (!result.ok || !result.data) {
      setError(result.message ?? "期間の取得に失敗しました。");
      setLoading(false);
      return;
    }
    setPeriods(result.data);

    const latest = result.data[0];
    if (latest) {
      const detail = await apiFetch<Schedule>(
        `/api/shift/schedule/${latest.id}`,
      );
      if (detail.ok && detail.data) setSchedule(detail.data);
      else setError(detail.message ?? "シフトの取得に失敗しました。");
    }
    setLoading(false);
  });

  const collecting = () => periods().filter((p) => p.status === "collecting");

  return (
    <ShiftLayout title="マイシフト">
      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <Show when={collecting().length > 0}>
        <Card title="希望シフトの提出" class={styles.section}>
          <ul class={styles.periodList}>
            <For each={collecting()}>
              {(period) => (
                <li class={styles.periodItem}>
                  <span>
                    {formatWorkDate(period.start_date)}〜
                    {formatWorkDate(period.end_date)}
                  </span>
                  <A
                    href={`/periods/${period.id}/availability`}
                    class={styles.submitLink}
                  >
                    希望を入力する
                  </A>
                </li>
              )}
            </For>
          </ul>
        </Card>
      </Show>

      <Show
        when={!loading()}
        fallback={<p class={styles.empty}>読み込み中…</p>}
      >
        <Show
          when={schedule()}
          fallback={<p class={styles.empty}>まだ期間がありません。</p>}
        >
          {(data) => (
            <Card
              title={`${formatWorkDate(data().period.start_date)}〜${formatWorkDate(
                data().period.end_date,
              )}`}
              class={styles.section}
            >
              <Show
                when={data().published}
                fallback={
                  <p class={styles.empty}>
                    この期間のシフトはまだ公開されていません。
                  </p>
                }
              >
                <Show
                  when={data().shifts.length > 0}
                  fallback={
                    <p class={styles.empty}>
                      この期間に割り当てられたシフトはありません。
                    </p>
                  }
                >
                  <ul class={styles.shiftList}>
                    <For each={data().shifts}>
                      {(shift) => (
                        <li class={styles.shiftItem}>
                          <span class={styles.shiftDate}>
                            {formatWorkDate(shift.work_date)}
                          </span>
                          <span class={styles.shiftTime}>
                            {formatMinutes(shift.start_minutes)}–
                            {formatMinutes(shift.end_minutes)}
                          </span>
                          <span class={styles.shiftMeta}>
                            実働 {Math.floor(workedMinutes(shift) / 60)}時間
                            {workedMinutes(shift) % 60 > 0
                              ? `${workedMinutes(shift) % 60}分`
                              : ""}
                          </span>
                          <Show when={shift.note}>
                            {(note) => (
                              <span class={styles.shiftNote}>{note()}</span>
                            )}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
            </Card>
          )}
        </Show>
      </Show>
    </ShiftLayout>
  );
}
