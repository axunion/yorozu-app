/** Whole yen with thousands separators, e.g. ¥1,200. */
export const formatYen = (amount: number) =>
  `¥${amount.toLocaleString("ja-JP")}`;

/** A price delta as a signed yen amount, e.g. +¥100; "" when it's 0. */
export function formatDelta(delta: number): string {
  if (delta === 0) return "";
  return `${delta > 0 ? "+" : "-"}${formatYen(Math.abs(delta))}`;
}
