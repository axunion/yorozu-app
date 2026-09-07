import type { PositionResponse } from "@yorozu/core";
import { jsonFetch } from "@yorozu/core/client";
import { Button, Card, Field } from "@yorozu/ui";
import { createSignal, For, Show } from "solid-js";
import styles from "./SettingsSection.module.css";

/**
 * Positions are retired, never deleted — shifts and staffing requirements
 * reference them, so a retired one still has to render in old schedules.
 */
export default function PositionsSection(props: {
  positions: PositionResponse[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = createSignal("");
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
    await run(
      jsonFetch("/api/shift/positions", "POST", {
        name: name(),
        sort_order: props.positions.length,
      }),
    );
    setName("");
  };

  const setActive = (position: PositionResponse, is_active: boolean) =>
    run(
      jsonFetch(`/api/shift/positions/${position.id}`, "PATCH", {
        name: position.name,
        sort_order: position.sort_order,
        is_active,
      }),
    );

  return (
    <Card title="ポジション" class={styles.section}>
      <Show
        when={props.positions.length > 0}
        fallback={<p class={styles.empty}>まだ登録がありません。</p>}
      >
        <ul class={styles.list}>
          <For each={props.positions}>
            {(position) => (
              <li class={styles.item}>
                <span class={position.is_active ? "" : styles.retired}>
                  {position.name}
                </span>
                <Show
                  when={position.is_active}
                  fallback={
                    <Button
                      variant="ghost"
                      size="sm"
                      class={styles.tapTarget}
                      aria-label={`「${position.name}」を復帰`}
                      disabled={busy()}
                      onClick={() => setActive(position, true)}
                    >
                      復帰
                    </Button>
                  }
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    class={styles.tapTarget}
                    aria-label={`「${position.name}」を使わない`}
                    disabled={busy()}
                    onClick={() => setActive(position, false)}
                  >
                    使わない
                  </Button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class={styles.addRow}>
        <Field
          id="position-name"
          label="ポジション名"
          value={name()}
          disabled={busy()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <Button
          aria-label="ポジションを追加"
          disabled={busy() || !name().trim()}
          onClick={add}
        >
          追加
        </Button>
      </div>
    </Card>
  );
}
