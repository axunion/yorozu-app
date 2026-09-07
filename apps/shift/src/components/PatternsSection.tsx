import type { ShiftPatternResponse } from "@yorozu/core";
import { jsonFetch } from "@yorozu/core/client";
import { Button, Card, Field } from "@yorozu/ui";
import { createSignal, For, Show } from "solid-js";
import { formatMinutes, parseMinutes } from "../lib/format";
import styles from "./SettingsSection.module.css";

/**
 * Named bands the builder offers as one-click buttons. An end past midnight
 * is stored as 25:00 and shown that way; the form takes it as a plain end
 * time and adds a day when it would otherwise run backwards.
 */
export default function PatternsSection(props: {
  patterns: ShiftPatternResponse[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = createSignal("");
  const [start, setStart] = createSignal(540);
  const [end, setEnd] = createSignal(1020);
  const [busy, setBusy] = createSignal(false);

  const run = async (request: Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    try {
      const result = await request;
      if (!result.ok) {
        props.onError(result.message ?? "更新に失敗しました。");
        return;
      }
      await props.onChanged();
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!name().trim()) return;
    // An end earlier than the start means the next morning, not a mistake.
    const endMinutes = end() <= start() ? end() + 1440 : end();
    await run(
      jsonFetch("/api/shift/templates/patterns", "POST", {
        name: name(),
        start_minutes: start(),
        end_minutes: endMinutes,
        sort_order: props.patterns.length,
      }),
    );
    setName("");
  };

  const retire = (pattern: ShiftPatternResponse) =>
    run(
      jsonFetch(`/api/shift/templates/patterns/${pattern.id}`, "PATCH", {
        ...pattern,
        is_active: false,
      }),
    );

  return (
    <Card title="シフトパターン" class={styles.section}>
      <Show
        when={props.patterns.length > 0}
        fallback={<p class={styles.empty}>まだ登録がありません。</p>}
      >
        <ul class={styles.list}>
          <For each={props.patterns}>
            {(pattern) => (
              <li class={styles.item}>
                <span class={styles.label}>
                  {pattern.name} {formatMinutes(pattern.start_minutes)}–
                  {formatMinutes(pattern.end_minutes)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  class={styles.tapTarget}
                  aria-label={`「${pattern.name}」を使わない`}
                  disabled={busy()}
                  onClick={() => retire(pattern)}
                >
                  使わない
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class={styles.addRow}>
        <Field
          id="pattern-name"
          label="パターン名"
          value={name()}
          disabled={busy()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <label class={styles.fieldLabel} for="pattern-start">
          開始
          <input
            id="pattern-start"
            type="time"
            aria-label="パターンの開始"
            class={styles.input}
            value={formatMinutes(start())}
            disabled={busy()}
            onInput={(e) => setStart(parseMinutes(e.currentTarget.value))}
          />
        </label>
        <label class={styles.fieldLabel} for="pattern-end">
          終了
          <input
            id="pattern-end"
            type="time"
            aria-label="パターンの終了"
            class={styles.input}
            value={formatMinutes(end())}
            disabled={busy()}
            onInput={(e) => setEnd(parseMinutes(e.currentTarget.value))}
          />
        </label>
        <Button
          aria-label="パターンを追加"
          disabled={busy() || !name().trim()}
          onClick={add}
        >
          追加
        </Button>
      </div>
    </Card>
  );
}
