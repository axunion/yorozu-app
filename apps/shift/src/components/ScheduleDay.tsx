import {
  type AvailabilitySubmissionLike,
  type CoverageRow,
  type DayAvailability,
  dayAvailability,
  type PositionResponse,
  type ShiftMemberResponse,
  type ShiftPatternResponse,
  type ShiftResponse,
} from "@yorozu/core";
import { Button, ConfirmDialog } from "@yorozu/ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import { formatMinutes, formatWorkDate } from "../lib/format";
import styles from "./ScheduleDay.module.css";

/** Who to offer first: people who can work, then the unknowns, then day-off requests. */
const AVAILABILITY_ORDER: Record<DayAvailability["kind"], number> = {
  available: 0,
  undecided: 1,
  not_submitted: 2,
  day_off: 3,
};

const WISH_CLASS: Record<DayAvailability["kind"], string> = {
  available: styles.wishAvailable ?? "",
  day_off: styles.wishDayOff ?? "",
  undecided: "",
  not_submitted: "",
};

function availabilityLabel(day: DayAvailability): string {
  switch (day.kind) {
    case "available":
      return `勤務可 ${day.bands
        .map(
          (b) =>
            `${formatMinutes(b.start_minutes)}–${formatMinutes(b.end_minutes)}`,
        )
        .join("、")}`;
    case "day_off":
      return "休み希望";
    case "undecided":
      return "未定";
    case "not_submitted":
      return "未提出";
  }
}

export type NewShift = {
  member_id: string;
  position_id: string | null;
  start_minutes: number;
  end_minutes: number;
  break_minutes: number;
};

/**
 * One business date: what the day needs, who is on it, and one control for
 * adding somebody. Coverage comes in already computed by `coverage()` — this
 * component only decides how a shortage or a surplus reads.
 */
export default function ScheduleDay(props: {
  workDate: string;
  shifts: ShiftResponse[];
  coverage: CoverageRow[];
  members: ShiftMemberResponse[];
  submissions: AvailabilitySubmissionLike[];
  positions: PositionResponse[];
  patterns: ShiftPatternResponse[];
  nameOf: (memberId: string) => string;
  positionNameOf: (positionId: string | null) => string;
  onAdd: (workDate: string, shift: NewShift) => void;
  onDelete: (shiftId: string) => void;
  busy: boolean;
}) {
  const [memberId, setMemberId] = createSignal("");
  const [positionId, setPositionId] = createSignal("");

  /** What each member asked for on this date. */
  const availability = createMemo(
    () =>
      new Map(
        props.members.map((member) => [
          member.id,
          dayAvailability(props.submissions, member.id, props.workDate),
        ]),
      ),
  );
  const dayOf = (memberId: string): DayAvailability =>
    availability().get(memberId) ?? { kind: "not_submitted" };

  /**
   * Members, best fit first. Sorts the member objects themselves rather than
   * fresh wrappers, so a schedule reload keeps the same <option> nodes and
   * the select keeps showing the member it holds.
   */
  const roster = createMemo(() =>
    [...props.members].sort(
      (a, b) =>
        AVAILABILITY_ORDER[dayOf(a.id).kind] -
        AVAILABILITY_ORDER[dayOf(b.id).kind],
    ),
  );

  const add = (pattern: ShiftPatternResponse) => {
    if (!memberId()) return;
    props.onAdd(props.workDate, {
      member_id: memberId(),
      position_id: positionId() || null,
      start_minutes: pattern.start_minutes,
      end_minutes: pattern.end_minutes,
      break_minutes: 0,
    });
  };

  return (
    <section class={styles.day}>
      <h3 class={styles.date}>{formatWorkDate(props.workDate)}</h3>

      <Show when={props.coverage.length > 0}>
        <ul class={styles.coverage}>
          <For each={props.coverage}>
            {(row) => (
              <li
                class={`${styles.band} ${
                  row.assigned < row.required
                    ? styles.shortage
                    : row.assigned > row.required
                      ? styles.surplus
                      : styles.met
                }`}
              >
                <span class={styles.bandName}>
                  {props.positionNameOf(row.position_id)}{" "}
                  {formatMinutes(row.start_minutes)}–
                  {formatMinutes(row.end_minutes)}
                </span>
                <span class={styles.count}>
                  {row.assigned}/{row.required}
                  <Show when={row.assigned < row.required}> 不足</Show>
                  <Show when={row.assigned > row.required}> 過剰</Show>
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={roster().length > 0}>
        <ul
          class={styles.availability}
          aria-label={`${formatWorkDate(props.workDate)}の希望`}
        >
          <For each={roster()}>
            {(member) => (
              <li class={`${styles.wish} ${WISH_CLASS[dayOf(member.id).kind]}`}>
                <span class={styles.wishName}>{props.nameOf(member.id)}</span>
                <span>{availabilityLabel(dayOf(member.id))}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show
        when={props.shifts.length > 0}
        fallback={<p class={styles.empty}>まだ誰も入っていません。</p>}
      >
        <ul class={styles.shifts}>
          <For each={props.shifts}>
            {(shift) => (
              <li class={styles.shift}>
                <span class={styles.who}>{props.nameOf(shift.member_id)}</span>
                <span class={styles.time}>
                  {formatMinutes(shift.start_minutes)}–
                  {formatMinutes(shift.end_minutes)}
                </span>
                <Show when={shift.position_id}>
                  {(id) => (
                    <span class={styles.position}>
                      {props.positionNameOf(id())}
                    </span>
                  )}
                </Show>
                <ConfirmDialog
                  triggerLabel="削除"
                  triggerVariant="ghost"
                  triggerDisabled={props.busy}
                  aria-label={`${formatWorkDate(props.workDate)}の${props.nameOf(
                    shift.member_id,
                  )}のシフトを削除`}
                  title="シフトの削除"
                  description={`${formatWorkDate(props.workDate)}の${props.nameOf(
                    shift.member_id,
                  )}のシフトを削除しますか？`}
                  confirmLabel="削除する"
                  onConfirm={() => props.onDelete(shift.id)}
                />
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class={styles.adder}>
        <label class={styles.adderLabel}>
          <span class={styles.srOnly}>
            {formatWorkDate(props.workDate)}に追加するスタッフ
          </span>
          <select
            class={styles.select}
            value={memberId()}
            onChange={(e) => setMemberId(e.currentTarget.value)}
          >
            <option value="">スタッフを選ぶ</option>
            <For each={roster()}>
              {(member) => (
                <option value={member.id}>
                  {props.nameOf(member.id)}（
                  {availabilityLabel(dayOf(member.id))}）
                </option>
              )}
            </For>
          </select>
        </label>

        <Show when={props.positions.length > 0}>
          <label class={styles.adderLabel}>
            <span class={styles.srOnly}>
              {formatWorkDate(props.workDate)}のポジション
            </span>
            <select
              class={styles.select}
              value={positionId()}
              onChange={(e) => setPositionId(e.currentTarget.value)}
            >
              <option value="">ポジションなし</option>
              <For each={props.positions}>
                {(position) => (
                  <option value={position.id}>{position.name}</option>
                )}
              </For>
            </select>
          </label>
        </Show>

        <Show
          when={props.patterns.length > 0}
          fallback={
            <span class={styles.noPatterns}>
              設定画面でシフトパターンを登録してください。
            </span>
          }
        >
          <For each={props.patterns}>
            {(pattern) => (
              <Button
                variant="secondary"
                size="sm"
                class={styles.tapTarget}
                aria-label={`${formatWorkDate(props.workDate)}に${pattern.name}で追加`}
                disabled={props.busy || !memberId()}
                onClick={() => add(pattern)}
              >
                {pattern.name} {formatMinutes(pattern.start_minutes)}–
                {formatMinutes(pattern.end_minutes)}
              </Button>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
