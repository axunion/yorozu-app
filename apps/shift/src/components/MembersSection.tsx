import type { PositionResponse, ShiftMemberResponse } from "@yorozu/core";
import { jsonFetch } from "@yorozu/core/client";
import { Button, Card } from "@yorozu/ui";
import { createSignal, For, Show } from "solid-js";
import styles from "./SettingsSection.module.css";

/**
 * Wage, weekly cap and the minor flag: the inputs `laborWarnings` and
 * `estimatedLaborCost` read. Owner-only on the API too — none of this may
 * reach a staff session.
 */
export default function MembersSection(props: {
  members: ShiftMemberResponse[];
  positions: PositionResponse[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = createSignal("");
  const [wage, setWage] = createSignal("");
  const [cap, setCap] = createSignal("");
  const [minor, setMinor] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  /** Returns whether the request succeeded, so a caller can gate follow-up state. */
  const run = async (
    request: Promise<{ ok: boolean; message?: string }>,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const result = await request;
      if (!result.ok) {
        props.onError(result.message ?? "更新に失敗しました。");
        return false;
      }
      await props.onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const open = (member: ShiftMemberResponse) => {
    setEditing(member.id);
    setWage(member.hourly_wage === null ? "" : String(member.hourly_wage));
    setCap(
      member.weekly_cap_minutes === null
        ? ""
        : String(member.weekly_cap_minutes / 60),
    );
    setMinor(member.is_minor);
  };

  const save = async (memberId: string) => {
    const capHours = Number(cap());
    const ok = await run(
      jsonFetch(`/api/shift/members/${memberId}/work-profile`, "PUT", {
        hourly_wage: wage() === "" ? null : Number(wage()),
        weekly_cap_minutes:
          cap() === "" || capHours <= 0 ? null : Math.round(capHours * 60),
        is_minor: minor(),
      }),
    );
    if (ok) setEditing("");
  };

  const togglePosition = (member: ShiftMemberResponse, positionId: string) => {
    const next = member.position_ids.includes(positionId)
      ? member.position_ids.filter((id) => id !== positionId)
      : [...member.position_ids, positionId];
    return run(
      jsonFetch(`/api/shift/members/${member.id}/positions`, "PUT", {
        position_ids: next,
      }),
    );
  };

  return (
    <Card title="スタッフ" class={styles.section}>
      <Show
        when={props.members.length > 0}
        fallback={<p class={styles.empty}>スタッフがいません。</p>}
      >
        <ul class={styles.list}>
          <For each={props.members}>
            {(member) => (
              <li class={styles.item}>
                <span class={styles.label}>{member.email}</span>

                <Show
                  when={editing() === member.id}
                  fallback={
                    <>
                      <span class={styles.meta}>
                        {member.hourly_wage === null
                          ? "時給未登録"
                          : `時給 ${member.hourly_wage}円`}
                        {member.weekly_cap_minutes === null
                          ? ""
                          : ` / 週${member.weekly_cap_minutes / 60}時間まで`}
                        {member.is_minor ? " / 18歳未満" : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        class={styles.tapTarget}
                        aria-label={`${member.email}の勤務条件を編集`}
                        disabled={busy()}
                        onClick={() => open(member)}
                      >
                        編集
                      </Button>
                    </>
                  }
                >
                  <div class={styles.addRow}>
                    <label class={styles.fieldLabel} for={`wage-${member.id}`}>
                      時給（円）
                      <input
                        id={`wage-${member.id}`}
                        type="number"
                        min="0"
                        class={`${styles.input} ${styles.numberInput}`}
                        value={wage()}
                        disabled={busy()}
                        onInput={(e) => setWage(e.currentTarget.value)}
                      />
                    </label>
                    <label class={styles.fieldLabel} for={`cap-${member.id}`}>
                      週上限（時間）
                      <input
                        id={`cap-${member.id}`}
                        type="number"
                        min="0"
                        class={`${styles.input} ${styles.numberInput}`}
                        value={cap()}
                        disabled={busy()}
                        onInput={(e) => setCap(e.currentTarget.value)}
                      />
                    </label>
                    <label class={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={minor()}
                        disabled={busy()}
                        onChange={(e) => setMinor(e.currentTarget.checked)}
                      />
                      18歳未満
                    </label>
                    <Button disabled={busy()} onClick={() => save(member.id)}>
                      保存
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy()}
                      onClick={() => setEditing("")}
                    >
                      やめる
                    </Button>
                  </div>
                </Show>

                <Show when={props.positions.length > 0}>
                  <fieldset class={styles.positionGroup}>
                    <legend class={styles.srOnly}>
                      {member.email}のポジション
                    </legend>
                    <For each={props.positions}>
                      {(position) => (
                        <button
                          type="button"
                          class={styles.positionChip}
                          aria-label={`${member.email} ${position.name}`}
                          aria-pressed={member.position_ids.includes(
                            position.id,
                          )}
                          disabled={busy()}
                          onClick={() => togglePosition(member, position.id)}
                        >
                          {position.name}
                        </button>
                      )}
                    </For>
                  </fieldset>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Card>
  );
}
