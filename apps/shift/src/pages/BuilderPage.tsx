import { useParams } from "@solidjs/router";
import type {
  PositionResponse,
  ScheduleResponse,
  ShiftMemberResponse,
  ShiftPatternResponse,
  ShiftResponse,
} from "@yorozu/core";
import {
  type CoverageRow,
  coverage,
  estimatedLaborCost,
  laborWarnings,
  periodDates,
  workedMinutes,
} from "@yorozu/core";
import { apiFetch, jsonFetch } from "@yorozu/core/client";
import { Button, Card, ErrorAlert } from "@yorozu/ui";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import CostSummary from "../components/CostSummary";
import ScheduleDay, { type NewShift } from "../components/ScheduleDay";
import WarningsPanel from "../components/WarningsPanel";
import ShiftLayout from "../layouts/ShiftLayout";
import { downloadCsv } from "../lib/download";
import {
  formatMinutes,
  formatWorkDate,
  PERIOD_STATUS_LABEL,
} from "../lib/format";
import styles from "./BuilderPage.module.css";

export default function BuilderPage() {
  const params = useParams<{ periodId: string }>();
  const [schedule, setSchedule] = createSignal<ScheduleResponse | null>(null);
  const [members, setMembers] = createSignal<ShiftMemberResponse[]>([]);
  const [positions, setPositions] = createSignal<PositionResponse[]>([]);
  const [patterns, setPatterns] = createSignal<ShiftPatternResponse[]>([]);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);

  const loadSchedule = async () => {
    const result = await apiFetch<ScheduleResponse>(
      `/api/shift/schedule/${params.periodId}`,
    );
    if (!result.ok || !result.data) {
      setError(result.message ?? "シフトの取得に失敗しました。");
      return;
    }
    setSchedule(result.data);
  };

  onMount(async () => {
    const [roster, positionList, patternList] = await Promise.all([
      apiFetch<ShiftMemberResponse[]>("/api/shift/members"),
      apiFetch<PositionResponse[]>("/api/shift/positions"),
      apiFetch<ShiftPatternResponse[]>("/api/shift/templates/patterns"),
      loadSchedule(),
    ]);
    if (roster.ok && roster.data) setMembers(roster.data);
    if (positionList.ok && positionList.data) setPositions(positionList.data);
    if (patternList.ok && patternList.data) setPatterns(patternList.data);
    setLoading(false);
  });

  const memberById = createMemo(() => new Map(members().map((m) => [m.id, m])));
  const positionById = createMemo(
    () => new Map(positions().map((p) => [p.id, p])),
  );

  const nameOf = (memberId: string) =>
    memberById().get(memberId)?.email ?? "不明なスタッフ";

  const positionNameOf = (positionId: string | null) =>
    (positionId ? positionById().get(positionId)?.name : undefined) ?? "";

  const dates = createMemo(() => {
    const period = schedule()?.period;
    return period ? periodDates(period.start_date, period.end_date) : [];
  });

  const shifts = () => schedule()?.shifts ?? [];

  const coverageRows = createMemo(() =>
    coverage(shifts(), schedule()?.requirements ?? [], dates()),
  );

  const shiftsByDate = createMemo(() => {
    const grouped = new Map<string, ShiftResponse[]>();
    for (const shift of shifts()) {
      const list = grouped.get(shift.work_date);
      if (list) list.push(shift);
      else grouped.set(shift.work_date, [shift]);
    }
    return grouped;
  });

  const coverageByDate = createMemo(() => {
    const grouped = new Map<string, CoverageRow[]>();
    for (const row of coverageRows()) {
      const list = grouped.get(row.work_date);
      if (list) list.push(row);
      else grouped.set(row.work_date, [row]);
    }
    return grouped;
  });

  /** The roster keyed the way the domain functions expect it. */
  const profiles = createMemo(() =>
    members().map(({ id, hourly_wage, weekly_cap_minutes, is_minor }) => ({
      member_id: id,
      hourly_wage,
      weekly_cap_minutes,
      is_minor,
    })),
  );

  const warnings = createMemo(() => laborWarnings(shifts(), profiles()));

  const cost = createMemo(() => estimatedLaborCost(shifts(), profiles()));

  /** Members with no submitted submission — who the manager still needs. */
  const nonSubmitters = createMemo(() => {
    const submitted = new Set(
      (schedule()?.submissions ?? [])
        .filter((s) => s.status === "submitted")
        .map((s) => s.member_id),
    );
    return members().filter((m) => !submitted.has(m.id));
  });

  const write = async (
    run: () => Promise<{ ok: boolean; message?: string }>,
  ) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await run();
      if (!result.ok) {
        setError(result.message ?? "更新に失敗しました。");
        return false;
      }
      await loadSchedule();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const addShift = (workDate: string, shift: NewShift) =>
    write(() =>
      jsonFetch<ShiftResponse>("/api/shift/shifts", "POST", {
        ...shift,
        period_id: params.periodId,
        work_date: workDate,
      }),
    );

  const deleteShift = (shiftId: string) =>
    write(() => apiFetch(`/api/shift/shifts/${shiftId}`, { method: "DELETE" }));

  const transition = async (action: "close-submissions" | "publish") => {
    const done = await write(() =>
      jsonFetch(`/api/shift/periods/${params.periodId}/${action}`, "POST", {}),
    );
    if (done) {
      setNotice(
        action === "publish"
          ? "公開しました。スタッフの画面に表示されます。"
          : "希望の受付を締め切りました。",
      );
    }
  };

  const exportCsv = () => {
    const period = schedule()?.period;
    if (!period) return;
    downloadCsv(
      [
        "日付",
        "スタッフ",
        "ポジション",
        "開始",
        "終了",
        "休憩(分)",
        "実働(分)",
      ],
      shifts().map((shift) => [
        shift.work_date,
        nameOf(shift.member_id),
        positionNameOf(shift.position_id),
        formatMinutes(shift.start_minutes),
        formatMinutes(shift.end_minutes),
        shift.break_minutes,
        workedMinutes(shift),
      ]),
      `shifts-${period.start_date}_${period.end_date}.csv`,
    );
  };

  return (
    <ShiftLayout title="シフト作成" backHref="/" backLabel="期間一覧">
      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>
      <p class={styles.notice} role="status">
        {notice()}
      </p>

      <Show
        when={!loading()}
        fallback={<p class={styles.empty}>読み込み中…</p>}
      >
        <Show
          when={schedule()}
          fallback={<p class={styles.empty}>期間が見つかりません。</p>}
        >
          {(data) => (
            <>
              <Card class={styles.header}>
                <div class={styles.headerRow}>
                  <span class={styles.range}>
                    {formatWorkDate(data().period.start_date)}〜
                    {formatWorkDate(data().period.end_date)}
                  </span>
                  <span class={styles.status}>
                    {PERIOD_STATUS_LABEL[data().period.status]}
                  </span>
                  <div class={styles.actions}>
                    <Button
                      variant="ghost"
                      disabled={shifts().length === 0}
                      onClick={exportCsv}
                    >
                      CSV出力
                    </Button>
                    <Show when={data().period.status === "collecting"}>
                      <Button
                        variant="secondary"
                        disabled={busy()}
                        onClick={() => transition("close-submissions")}
                      >
                        希望を締め切る
                      </Button>
                    </Show>
                    <Show when={data().period.status === "building"}>
                      <Button
                        disabled={busy()}
                        onClick={() => transition("publish")}
                      >
                        公開する
                      </Button>
                    </Show>
                  </div>
                </div>
                <Show when={nonSubmitters().length > 0}>
                  <p class={styles.nonSubmitters}>
                    未提出：
                    {nonSubmitters()
                      .map((m) => m.email)
                      .join("、")}
                  </p>
                </Show>
              </Card>

              <WarningsPanel warnings={warnings()} nameOf={nameOf} />
              <CostSummary cost={cost()} nameOf={nameOf} />

              <Card title="日ごとの割り当て" class={styles.grid}>
                <For each={dates()}>
                  {(workDate) => (
                    <ScheduleDay
                      workDate={workDate}
                      shifts={shiftsByDate().get(workDate) ?? []}
                      coverage={coverageByDate().get(workDate) ?? []}
                      members={members()}
                      positions={positions()}
                      patterns={patterns()}
                      nameOf={nameOf}
                      positionNameOf={positionNameOf}
                      onAdd={addShift}
                      onDelete={deleteShift}
                      busy={busy()}
                    />
                  )}
                </For>
              </Card>
            </>
          )}
        </Show>
      </Show>
    </ShiftLayout>
  );
}
