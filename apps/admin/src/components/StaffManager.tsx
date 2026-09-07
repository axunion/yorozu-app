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
        { email: email(), role: role() },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "招待に失敗しました。");
        return;
      }
      const invited = result.data;
      setMembers((prev) => [...prev, invited]);
      setEmail("");
      setRole("staff");
    } finally {
      setSubmitting(false);
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
