/**
 * Display formatting for the shift screens. Minutes are offsets from the
 * business date's 00:00, so a value past 1440 renders as 25:00 rather than
 * wrapping to 01:00 — that is what tells a reader the shift runs overnight.
 */

import { jstDayRange, toJstWeekday } from "@yorozu/core";

/** 540 -> "09:00", 1500 -> "25:00". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** "09:30" -> 570. The inverse of formatMinutes for a band inside one day. */
export function parseMinutes(value: string): number {
  const [hours = "0", rest = "0"] = value.split(":");
  return Number(hours) * 60 + Number(rest);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** "2026-09-01" -> 2. Sunday is 0, matching toJstWeekday(). */
export function weekdayOf(workDate: string): number {
  return toJstWeekday(jstDayRange(workDate).from);
}

/** "2026-09-01" -> "9/1(火)". */
export function formatWorkDate(workDate: string): string {
  const [, month = "", day = ""] = workDate.split("-");
  return `${Number(month)}/${Number(day)}(${WEEKDAYS[weekdayOf(workDate)] ?? ""})`;
}

/** Period statuses, as a manager reads them. */
export const PERIOD_STATUS_LABEL = {
  collecting: "希望受付中",
  building: "作成中",
  published: "公開済み",
} as const;

/** 12345 -> "¥12,345". */
export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}
