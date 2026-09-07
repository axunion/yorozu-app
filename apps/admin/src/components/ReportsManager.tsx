import {
  jstDayRange,
  jstMonthRange,
  jstWeekRange,
  todayJst,
  toJstDateString,
  toJstHour,
  toJstWeekday,
} from "@yorozu/core";
import { apiFetch } from "@yorozu/core/client";
import { Button, ErrorAlert } from "@yorozu/ui";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { downloadCsv } from "../lib/download";
import styles from "./ReportsManager.module.css";

type ReportOption = { price_delta_snapshot: number };
type ReportItem = {
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  status: "ordered" | "served" | "cancelled";
  options: ReportOption[];
};
type ReportPayment = {
  id: string;
  total_amount: number;
  paid_at: number;
  voided_at: number | null;
  items: ReportItem[];
};

type RangeMode = "week" | "month" | "custom";
type RankingSortKey = "revenue" | "quantity";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const formatCurrency = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;

export default function ReportsManager() {
  const [rangeMode, setRangeMode] = createSignal<RangeMode>("week");
  const [customFrom, setCustomFrom] = createSignal(todayJst());
  const [customTo, setCustomTo] = createSignal(todayJst());
  const [payments, setPayments] = createSignal<ReportPayment[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [sortKey, setSortKey] = createSignal<RankingSortKey>("revenue");

  const range = createMemo(() => {
    const mode = rangeMode();
    if (mode === "week") return jstWeekRange(todayJst());
    if (mode === "month") return jstMonthRange(todayJst());
    return {
      from: jstDayRange(customFrom()).from,
      to: jstDayRange(customTo()).to,
    };
  });

  async function load() {
    setLoading(true);
    setError("");
    const { from, to } = range();
    const result = await apiFetch<ReportPayment[]>(
      `/api/payments?from=${from}&to=${to}`,
    );
    if (result.ok && result.data) {
      setPayments(result.data);
    } else {
      setPayments([]);
      setError(result.message ?? "データの取得に失敗しました。");
    }
    setLoading(false);
  }

  createEffect(() => {
    range();
    load();
  });

  // Voided payments never count toward any report total, same rule the
  // existing sales-history page applies.
  const settledPayments = createMemo(() =>
    payments().filter((p) => p.voided_at === null),
  );

  const itemRanking = createMemo(() => {
    const map = new Map<string, { quantity: number; revenue: number }>();
    for (const payment of settledPayments()) {
      for (const item of payment.items) {
        if (item.status === "cancelled") continue;
        const optionDelta = item.options.reduce(
          (sum, o) => sum + o.price_delta_snapshot,
          0,
        );
        const revenue =
          (item.unit_price_snapshot + optionDelta) * item.quantity;
        const entry = map.get(item.name_snapshot) ?? {
          quantity: 0,
          revenue: 0,
        };
        entry.quantity += item.quantity;
        entry.revenue += revenue;
        map.set(item.name_snapshot, entry);
      }
    }
    const rows = [...map.entries()].map(([name, v]) => ({ name, ...v }));
    const key = sortKey();
    rows.sort((a, b) => b[key] - a[key]);
    return rows;
  });

  const weekdayBreakdown = createMemo(() => {
    const totals = Array.from({ length: 7 }, () => 0);
    const counts = Array.from({ length: 7 }, () => 0);
    for (const payment of settledPayments()) {
      const day = toJstWeekday(payment.paid_at);
      totals[day] = (totals[day] ?? 0) + payment.total_amount;
      counts[day] = (counts[day] ?? 0) + 1;
    }
    return WEEKDAY_LABELS.map((label, i) => ({
      label,
      total: totals[i] ?? 0,
      count: counts[i] ?? 0,
    }));
  });
  const weekdayMax = createMemo(() =>
    Math.max(1, ...weekdayBreakdown().map((d) => d.total)),
  );

  const hourBreakdown = createMemo(() => {
    const totals = Array.from({ length: 24 }, () => 0);
    const counts = Array.from({ length: 24 }, () => 0);
    for (const payment of settledPayments()) {
      const hour = toJstHour(payment.paid_at);
      totals[hour] = (totals[hour] ?? 0) + payment.total_amount;
      counts[hour] = (counts[hour] ?? 0) + 1;
    }
    return totals.map((total, hour) => ({
      hour,
      total,
      count: counts[hour] ?? 0,
    }));
  });
  const hourMax = createMemo(() =>
    Math.max(1, ...hourBreakdown().map((h) => h.total)),
  );

  const rangeLabel = createMemo(() => {
    const { from, to } = range();
    return `${toJstDateString(from)}_${toJstDateString(to)}`;
  });

  const handleExportRanking = () => {
    downloadCsv(
      ["商品名", "数量", "売上金額"],
      itemRanking().map((r) => [r.name, r.quantity, r.revenue]),
      `item-ranking-${rangeLabel()}.csv`,
    );
  };

  const handleExportWeekday = () => {
    downloadCsv(
      ["曜日", "件数", "売上金額"],
      weekdayBreakdown().map((d) => [d.label, d.count, d.total]),
      `weekday-breakdown-${rangeLabel()}.csv`,
    );
  };

  return (
    <div class={styles.reportsManager}>
      <div class={styles.rangeNav}>
        <Button
          variant={rangeMode() === "week" ? "primary" : "secondary"}
          size="sm"
          aria-pressed={rangeMode() === "week"}
          onClick={() => setRangeMode("week")}
        >
          今週
        </Button>
        <Button
          variant={rangeMode() === "month" ? "primary" : "secondary"}
          size="sm"
          aria-pressed={rangeMode() === "month"}
          onClick={() => setRangeMode("month")}
        >
          今月
        </Button>
        <Button
          variant={rangeMode() === "custom" ? "primary" : "secondary"}
          size="sm"
          aria-pressed={rangeMode() === "custom"}
          onClick={() => setRangeMode("custom")}
        >
          カスタム
        </Button>
        <Show when={rangeMode() === "custom"}>
          <input
            type="date"
            class={styles.dateInput}
            aria-label="開始日"
            value={customFrom()}
            onInput={(e) => setCustomFrom(e.currentTarget.value)}
          />
          <span>〜</span>
          <input
            type="date"
            class={styles.dateInput}
            aria-label="終了日"
            value={customTo()}
            onInput={(e) => setCustomTo(e.currentTarget.value)}
          />
        </Show>
      </div>

      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <Show when={!loading() && !error()}>
        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h2 class={styles.heading}>商品ランキング</h2>
            <Button variant="secondary" size="sm" onClick={handleExportRanking}>
              商品ランキングをCSVダウンロード
            </Button>
          </div>
          <Show
            when={itemRanking().length > 0}
            fallback={<p class={styles.empty}>この期間の売上はありません</p>}
          >
            <table class={styles.table}>
              <thead>
                <tr>
                  <th>商品名</th>
                  <th
                    aria-sort={sortKey() === "quantity" ? "descending" : "none"}
                  >
                    <button
                      type="button"
                      class={styles.sortButton}
                      onClick={() => setSortKey("quantity")}
                    >
                      数量
                    </button>
                  </th>
                  <th
                    aria-sort={sortKey() === "revenue" ? "descending" : "none"}
                  >
                    <button
                      type="button"
                      class={styles.sortButton}
                      onClick={() => setSortKey("revenue")}
                    >
                      売上金額
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={itemRanking()}>
                  {(row) => (
                    <tr>
                      <td>{row.name}</td>
                      <td>{row.quantity}</td>
                      <td>{formatCurrency(row.revenue)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </section>

        <section class={styles.section}>
          <div class={styles.sectionHeader}>
            <h2 class={styles.heading}>曜日別売上</h2>
            <Button variant="secondary" size="sm" onClick={handleExportWeekday}>
              曜日別売上をCSVダウンロード
            </Button>
          </div>
          <table class={styles.table}>
            <thead>
              <tr>
                <th>曜日</th>
                <th>件数</th>
                <th>売上金額</th>
              </tr>
            </thead>
            <tbody>
              <For each={weekdayBreakdown()}>
                {(day) => (
                  <tr>
                    <td>{day.label}</td>
                    <td>{day.count}件</td>
                    <td>
                      <div class={styles.barCell}>
                        <div
                          class={styles.bar}
                          style={{
                            width: `${(day.total / weekdayMax()) * 100}%`,
                          }}
                        />
                        <span>{formatCurrency(day.total)}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>

        <section class={styles.section}>
          <h2 class={styles.heading}>時間帯別売上</h2>
          <ul class={styles.hourList} aria-label="時間帯別売上">
            <For each={hourBreakdown()}>
              {(h) => (
                <li class={styles.hourItem}>
                  <span class={styles.hourLabel}>{h.hour}時</span>
                  <div class={styles.barCell}>
                    <div
                      class={styles.bar}
                      style={{ width: `${(h.total / hourMax()) * 100}%` }}
                    />
                    <span>{formatCurrency(h.total)}</span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}
