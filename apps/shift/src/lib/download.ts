/**
 * CSV download. Copied from apps/admin/src/lib/download.ts rather than
 * promoted to @yorozu/ui: two call sites is not three, and the shift export
 * needs no JSON counterpart. Promote if a third app wants it.
 */

/** Wraps a field in quotes (doubling internal quotes) when it needs them. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds the CSV text, BOM included so Excel reads the Japanese correctly. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvField).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}

/**
 * Triggers a browser download of `headers` + `rows` as `filename`. The link
 * is attached before clicking (some browsers need that for `download` to
 * fire) and the object URL is revoked on a delay so a caller that navigates
 * away does not race the download's start.
 */
export function downloadCsv(
  headers: string[],
  rows: (string | number)[][],
  filename: string,
): void {
  const blob = new Blob([toCsv(headers, rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
