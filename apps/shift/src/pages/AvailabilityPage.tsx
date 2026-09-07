import { useParams } from "@solidjs/router";
import type {
  AvailabilityEntryResponse,
  AvailabilitySubmissionResponse,
  SchedulePeriodResponse,
} from "@yorozu/core";
import { periodDates } from "@yorozu/core";
import { apiFetch, jsonFetch } from "@yorozu/core/client";
import { Button, Card, ErrorAlert } from "@yorozu/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import ShiftLayout from "../layouts/ShiftLayout";
import {
  formatMinutes,
  formatWorkDate,
  parseMinutes,
  weekdayOf,
} from "../lib/format";
import styles from "./AvailabilityPage.module.css";

type Kind = "none" | "available" | "day_off";

type DayChoice = {
  work_date: string;
  kind: Kind;
  /** Minutes from the business date's 00:00, as the API stores them. */
  start_minutes: number;
  end_minutes: number;
};

const CHOICES = [
  ["none", "未定"],
  ["available", "勤務可"],
  ["day_off", "休み"],
] as const satisfies readonly (readonly [Kind, string])[];

const DEFAULT_START = 540; // 09:00
const DEFAULT_END = 1020; // 17:00

/** An end at or past midnight cannot be typed into <input type="time">. */
const isOvernight = (day: DayChoice) => day.end_minutes >= 1440;

export default function AvailabilityPage() {
  const params = useParams<{ periodId: string }>();
  const [period, setPeriod] = createSignal<SchedulePeriodResponse | null>(null);
  const [days, setDays] = createStore<DayChoice[]>([]);
  const [error, setError] = createSignal("");
  const [saved, setSaved] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [closed, setClosed] = createSignal(false);
  const [previousPeriodId, setPreviousPeriodId] = createSignal("");
  const [copying, setCopying] = createSignal(false);

  onMount(async () => {
    const periodResult = await apiFetch<SchedulePeriodResponse>(
      `/api/shift/periods/${params.periodId}`,
    );
    if (!periodResult.ok || !periodResult.data) {
      setError(periodResult.message ?? "期間の取得に失敗しました。");
      setLoading(false);
      return;
    }
    setPeriod(periodResult.data);
    setClosed(periodResult.data.status !== "collecting");

    // The list is newest first, so the first period starting earlier than
    // this one is the one to copy from.
    const periods =
      await apiFetch<SchedulePeriodResponse[]>("/api/shift/periods");
    if (periods.ok && periods.data) {
      const start = periodResult.data.start_date;
      const previous = periods.data.find(
        (candidate) => candidate.start_date < start,
      );
      setPreviousPeriodId(previous?.id ?? "");
    }

    const submission = await apiFetch<AvailabilitySubmissionResponse>(
      `/api/shift/availability/${params.periodId}/me`,
    );
    const entries = submission.ok ? (submission.data?.entries ?? []) : [];

    setDays(
      periodDates(periodResult.data.start_date, periodResult.data.end_date).map(
        (work_date) => {
          const entry = entries.find((e) => e.work_date === work_date);
          return {
            work_date,
            kind: entry?.kind ?? "none",
            start_minutes: entry?.start_minutes ?? DEFAULT_START,
            end_minutes: entry?.end_minutes ?? DEFAULT_END,
          };
        },
      ),
    );
    setLoading(false);
  });

  /**
   * Updates one field of one row in place. Replacing the whole row object
   * would make <For> — which keys by reference — tear down and rebuild that
   * row's DOM, so a time input would lose focus on every keystroke.
   */
  const update = (index: number, patch: Partial<DayChoice>) => {
    setDays(index, patch);
  };

  /**
   * Prefills the form from the previous period, matched by weekday — the
   * substitute for standing weekday availability rules, which v1 does not
   * store. Nothing is saved until the member presses a save button.
   */
  const copyPrevious = async () => {
    const id = previousPeriodId();
    if (!id) return;
    setError("");
    setSaved("");
    setCopying(true);
    try {
      const result = await apiFetch<AvailabilitySubmissionResponse>(
        `/api/shift/availability/${id}/me`,
      );
      if (!result.ok) {
        setError(result.message ?? "前の期間の取得に失敗しました。");
        return;
      }

      const byWeekday = new Map<number, AvailabilityEntryResponse>();
      for (const entry of result.data?.entries ?? []) {
        const weekday = weekdayOf(entry.work_date);
        if (!byWeekday.has(weekday)) byWeekday.set(weekday, entry);
      }
      if (byWeekday.size === 0) {
        setSaved("前の期間には入力がありませんでした。");
        return;
      }

      days.forEach((day, index) => {
        const entry = byWeekday.get(weekdayOf(day.work_date));
        if (!entry) return;
        setDays(index, {
          kind: entry.kind,
          start_minutes: entry.start_minutes ?? DEFAULT_START,
          end_minutes: entry.end_minutes ?? DEFAULT_END,
        });
      });
      setSaved("前の期間の内容をコピーしました。保存すると確定します。");
    } finally {
      setCopying(false);
    }
  };

  const isInvalid = (day: DayChoice) =>
    day.kind === "available" && day.end_minutes <= day.start_minutes;

  const hasInvalid = () => days.some(isInvalid);

  const save = async (submit: boolean) => {
    setError("");
    setSaved("");
    setSaving(true);
    try {
      const entries = days
        .filter((day) => day.kind !== "none")
        .map((day) =>
          day.kind === "day_off"
            ? { work_date: day.work_date, kind: "day_off" as const }
            : {
                work_date: day.work_date,
                kind: "available" as const,
                start_minutes: day.start_minutes,
                end_minutes: day.end_minutes,
              },
        );

      const result = await jsonFetch(
        `/api/shift/availability/${params.periodId}/me`,
        "PUT",
        { submit, entries },
      );
      if (!result.ok) {
        setError(result.message ?? "保存に失敗しました。");
        return;
      }
      setSaved(submit ? "提出しました。" : "下書きを保存しました。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ShiftLayout title="希望シフトの提出" backHref="/" backLabel="マイシフト">
      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>
      {/* Always in the DOM: a live region added to the page after the fact
          is not announced. */}
      <p class={styles.saved} role="status">
        {saved()}
      </p>

      <Show when={closed()}>
        <p class={styles.closed}>
          この期間の希望受付は締め切られています。内容は確認のみ可能です。
        </p>
      </Show>

      <Show when={loading()}>
        <p class={styles.loading}>読み込み中…</p>
      </Show>

      <Show when={period()}>
        <Card class={styles.card}>
          <Show when={!closed() && previousPeriodId()}>
            <div class={styles.copyRow}>
              <Button
                variant="ghost"
                disabled={copying()}
                onClick={copyPrevious}
              >
                前の期間からコピー
              </Button>
              <span class={styles.copyHint}>
                曜日ごとに前の期間の内容を写します。保存するまで確定しません。
              </span>
            </div>
          </Show>

          <ul class={styles.dayList}>
            <For each={days}>
              {(day, index) => (
                <li class={styles.day}>
                  <span class={styles.date}>
                    {formatWorkDate(day.work_date)}
                  </span>

                  <fieldset class={styles.choices}>
                    <legend class={styles.srOnly}>
                      {formatWorkDate(day.work_date)}の希望
                    </legend>
                    <For each={CHOICES}>
                      {([kind, label]) => (
                        <button
                          type="button"
                          class={styles.choice}
                          aria-pressed={day.kind === kind}
                          disabled={closed()}
                          onClick={() => update(index(), { kind })}
                        >
                          {label}
                        </button>
                      )}
                    </For>
                  </fieldset>

                  <Show when={day.kind === "available"}>
                    <Show
                      when={!isOvernight(day)}
                      fallback={
                        <div class={styles.times}>
                          {/* A band ending at or past midnight has no
                              <input type="time"> representation, so it is
                              shown as stored and re-entered deliberately. */}
                          <span class={styles.overnight}>
                            {formatMinutes(day.start_minutes)}–
                            {formatMinutes(day.end_minutes)}
                          </span>
                          <Show when={!closed()}>
                            <button
                              type="button"
                              class={styles.reenter}
                              onClick={() =>
                                update(index(), {
                                  start_minutes: DEFAULT_START,
                                  end_minutes: DEFAULT_END,
                                })
                              }
                            >
                              入力し直す
                            </button>
                          </Show>
                        </div>
                      }
                    >
                      <div class={styles.times}>
                        <label class={styles.timeLabel}>
                          <span class={styles.srOnly}>
                            {formatWorkDate(day.work_date)}の開始時刻
                          </span>
                          <input
                            type="time"
                            class={styles.time}
                            value={formatMinutes(day.start_minutes)}
                            disabled={closed()}
                            onInput={(e) =>
                              update(index(), {
                                start_minutes: parseMinutes(
                                  e.currentTarget.value,
                                ),
                              })
                            }
                          />
                        </label>
                        <span aria-hidden="true">–</span>
                        <label class={styles.timeLabel}>
                          <span class={styles.srOnly}>
                            {formatWorkDate(day.work_date)}の終了時刻
                          </span>
                          <input
                            type="time"
                            class={styles.time}
                            value={formatMinutes(day.end_minutes)}
                            disabled={closed()}
                            onInput={(e) =>
                              update(index(), {
                                end_minutes: parseMinutes(
                                  e.currentTarget.value,
                                ),
                              })
                            }
                          />
                        </label>
                        <Show when={isInvalid(day)}>
                          <span class={styles.invalid}>
                            終了は開始より後にしてください
                          </span>
                        </Show>
                      </div>
                    </Show>
                  </Show>
                </li>
              )}
            </For>
          </ul>

          <Show when={!closed()}>
            <div class={styles.actions}>
              <Button
                variant="secondary"
                disabled={saving() || hasInvalid()}
                onClick={() => save(false)}
              >
                下書き保存
              </Button>
              <Button
                disabled={saving() || hasInvalid()}
                onClick={() => save(true)}
              >
                提出する
              </Button>
            </div>
          </Show>
        </Card>
      </Show>
    </ShiftLayout>
  );
}
