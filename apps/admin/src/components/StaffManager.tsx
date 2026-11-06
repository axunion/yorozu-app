import type { StaffMemberResponse } from "@yorozu/core";
import { apiFetch, jsonFetch } from "@yorozu/core/client";
import { Button, ConfirmDialog, ErrorAlert, Field, Select } from "@yorozu/ui";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { useStoreInfo } from "../layouts/AdminGuard";
import styles from "./StaffManager.module.css";
import StatusBadge from "./StatusBadge";

const ROLE_OPTIONS = [
  { value: "staff", label: "スタッフ" },
  { value: "owner", label: "オーナー" },
];

const ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  staff: "スタッフ",
};

export default function StaffManager() {
  const store = useStoreInfo();
  const [members, setMembers] = createSignal<StaffMemberResponse[]>([]);
  const [error, setError] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editName, setEditName] = createSignal("");
  const [savingName, setSavingName] = createSignal(false);
  const [role, setRole] = createSignal("staff");
  const [submitting, setSubmitting] = createSignal(false);

  const ownerCount = createMemo(
    () => members().filter((m) => m.role === "owner").length,
  );

  async function loadMembers() {
    const result = await apiFetch<StaffMemberResponse[]>("/api/staff");
    if (result.ok && result.data) {
      setMembers(result.data);
    } else if (!result.ok) {
      setError(result.message ?? "メンバー一覧の取得に失敗しました。");
    }
  }

  onMount(async () => {
    await loadMembers();
  });

  const handleInvite = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await jsonFetch<StaffMemberResponse>(
        "/api/staff",
        "POST",
        { email: email(), role: role(), display_name: displayName() },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "招待に失敗しました。");
        return;
      }
      const invited = result.data;
      setMembers((prev) => [...prev, invited]);
      setEmail("");
      setDisplayName("");
      setRole("staff");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (member: StaffMemberResponse) => {
    setEditName(member.display_name ?? "");
    setEditingId(member.id);
  };

  // The edit button and the form replace each other, so focus would drop to
  // <body>; hand it back to the member's edit button instead.
  const endEdit = (member: StaffMemberResponse) => {
    setEditingId(null);
    queueMicrotask(() =>
      document
        .querySelector<HTMLButtonElement>(
          `[aria-label="${CSS.escape(`表示名を編集 ${member.email}`)}"]`,
        )
        ?.focus(),
    );
  };

  const handleRename = async (e: SubmitEvent, member: StaffMemberResponse) => {
    const id = member.id;
    e.preventDefault();
    setError("");
    setSavingName(true);
    try {
      const result = await jsonFetch<{
        id: string;
        display_name: string | null;
      }>(`/api/staff/${id}`, "PATCH", { display_name: editName() });
      if (!result.ok || !result.data) {
        setError(result.message ?? "表示名の保存に失敗しました。");
        return;
      }
      const { display_name } = result.data;
      setMembers((prev) =>
        prev.map((m) => (m.id === id ? { ...m, display_name } : m)),
      );
      endEdit(member);
    } finally {
      setSavingName(false);
    }
  };

  const handleRemove = async (id: string) => {
    setError("");
    const result = await apiFetch(`/api/staff/${id}`, { method: "DELETE" });
    if (!result.ok) {
      setError(result.message ?? "削除に失敗しました。");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <div class={styles.staffManager}>
      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <section class={styles.section}>
        <h2 class={styles.heading}>スタッフを招待</h2>
        <form onSubmit={handleInvite} class={styles.form}>
          <Field
            id="staff-invite-email"
            label="メールアドレス"
            type="email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            placeholder="例：staff@example.com"
            required
            disabled={submitting()}
          />
          <Field
            id="staff-invite-name"
            label="表示名（任意）"
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
            placeholder="例：山田 花子"
            maxLength={50}
            disabled={submitting()}
          />
          <div class={styles.roleField}>
            <label for="staff-invite-role" class={styles.roleLabel}>
              権限
            </label>
            <Select
              id="staff-invite-role"
              aria-label="権限"
              options={ROLE_OPTIONS}
              value={role()}
              onChange={setRole}
              disabled={submitting()}
            />
          </div>
          <Button type="submit" disabled={submitting()}>
            {submitting() ? "招待中..." : "招待する"}
          </Button>
        </form>
      </section>

      <section class={styles.section}>
        <h2 class={styles.heading}>メンバー一覧</h2>
        <Show
          when={members().length > 0}
          fallback={<p class={styles.empty}>メンバーがいません</p>}
        >
          <ul class={styles.memberList}>
            <For each={members()}>
              {(member) => {
                const isSelf = () => member.email === store.email;
                const isLastOwner = () =>
                  member.role === "owner" && ownerCount() <= 1;
                return (
                  <li class={styles.memberItem}>
                    <div class={styles.memberInfo}>
                      <span class={styles.memberName}>
                        {member.display_name ?? "（表示名なし）"}
                      </span>
                      <span class={styles.memberEmail}>{member.email}</span>
                      <span class={styles.memberRole}>
                        {ROLE_LABEL[member.role] ?? member.role}
                      </span>
                      <StatusBadge
                        tone={
                          member.status === "active" ? "success" : "warning"
                        }
                      >
                        {member.status === "active" ? "有効" : "招待中"}
                      </StatusBadge>
                    </div>
                    <Show
                      when={editingId() === member.id}
                      fallback={
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`表示名を編集 ${member.email}`}
                          onClick={() => startEdit(member)}
                        >
                          表示名を編集
                        </Button>
                      }
                    >
                      <form
                        class={styles.renameForm}
                        onSubmit={(e) => handleRename(e, member)}
                      >
                        <Field
                          id={`staff-name-${member.id}`}
                          label="表示名"
                          value={editName()}
                          onInput={(e) => setEditName(e.currentTarget.value)}
                          onKeyDown={(e) =>
                            e.key === "Escape" && endEdit(member)
                          }
                          ref={(el) => queueMicrotask(() => el.focus())}
                          maxLength={50}
                          disabled={savingName()}
                        />
                        <Button type="submit" size="sm" disabled={savingName()}>
                          {savingName() ? "保存中..." : "保存"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={savingName()}
                          onClick={() => endEdit(member)}
                        >
                          キャンセル
                        </Button>
                      </form>
                    </Show>
                    <ConfirmDialog
                      triggerLabel="削除"
                      triggerDisabled={isSelf() || isLastOwner()}
                      aria-label={`削除 ${member.email}`}
                      title="メンバーの削除"
                      description={`「${member.email}」を削除しますか？この操作は元に戻せません。`}
                      confirmLabel="削除する"
                      onConfirm={() => handleRemove(member.id)}
                    />
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}
