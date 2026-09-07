import { apiFetch, jsonFetch } from "@yorozu/core/client";
import { Button, ConfirmDialog, ErrorAlert, Field } from "@yorozu/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import styles from "./OptionGroupManager.module.css";

type OptionGroup = {
  id: string;
  store_id: string;
  name: string;
  min_select: number;
  max_select: number;
  sort_order: number;
};

type Option = {
  id: string;
  store_id: string;
  group_id: string;
  name: string;
  price_delta: number;
  sort_order: number;
};

export default function OptionGroupManager() {
  const [groups, setGroups] = createSignal<OptionGroup[]>([]);
  const [optionsByGroupId, setOptionsByGroupId] = createSignal<
    Record<string, Option[]>
  >({});
  const [error, setError] = createSignal("");

  const [groupName, setGroupName] = createSignal("");
  const [groupMinSelect, setGroupMinSelect] = createSignal(0);
  const [groupMaxSelect, setGroupMaxSelect] = createSignal(1);
  const [groupSubmitting, setGroupSubmitting] = createSignal(false);

  const [editingGroupId, setEditingGroupId] = createSignal<string | null>(null);
  const [editGroupName, setEditGroupName] = createSignal("");
  const [editGroupMinSelect, setEditGroupMinSelect] = createSignal(0);
  const [editGroupMaxSelect, setEditGroupMaxSelect] = createSignal(1);
  const [groupUpdating, setGroupUpdating] = createSignal(false);

  const [optionName, setOptionName] = createSignal<Record<string, string>>({});
  const [optionPriceDelta, setOptionPriceDelta] = createSignal<
    Record<string, string>
  >({});
  const [optionSubmittingGroupId, setOptionSubmittingGroupId] = createSignal<
    string | null
  >(null);

  const [editingOptionId, setEditingOptionId] = createSignal<string | null>(
    null,
  );
  const [editOptionName, setEditOptionName] = createSignal("");
  const [editOptionPriceDelta, setEditOptionPriceDelta] = createSignal("");
  const [optionUpdating, setOptionUpdating] = createSignal(false);

  async function loadOptionsForGroup(groupId: string) {
    const result = await apiFetch<Option[]>(
      `/api/menu/option-groups/${groupId}/options`,
    );
    if (result.ok && result.data) {
      setOptionsByGroupId((prev) => ({
        ...prev,
        [groupId]: result.data as Option[],
      }));
    } else {
      setError(result.message ?? "選択肢の取得に失敗しました");
    }
  }

  async function loadGroups() {
    const result = await apiFetch<OptionGroup[]>("/api/menu/option-groups");
    if (result.ok && result.data) {
      setGroups(result.data);
      await Promise.all(result.data.map((g) => loadOptionsForGroup(g.id)));
    } else {
      setError(result.message ?? "オプショングループの取得に失敗しました");
    }
  }

  onMount(async () => {
    await loadGroups();
  });

  const handleGroupSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setGroupSubmitting(true);
    try {
      const result = await jsonFetch<OptionGroup>(
        "/api/menu/option-groups",
        "POST",
        {
          name: groupName(),
          min_select: groupMinSelect(),
          max_select: groupMaxSelect(),
        },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "エラーが発生しました");
        return;
      }
      setGroupName("");
      setGroupMinSelect(0);
      setGroupMaxSelect(1);
      setGroups((prev) => [...prev, result.data as OptionGroup]);
    } finally {
      setGroupSubmitting(false);
    }
  };

  const startGroupEdit = (group: OptionGroup) => {
    setEditingGroupId(group.id);
    setEditGroupName(group.name);
    setEditGroupMinSelect(group.min_select);
    setEditGroupMaxSelect(group.max_select);
    setError("");
  };

  const cancelGroupEdit = () => setEditingGroupId(null);

  const handleGroupEditSubmit = async (e: SubmitEvent, groupId: string) => {
    e.preventDefault();
    setError("");
    setGroupUpdating(true);
    try {
      const result = await jsonFetch<OptionGroup>(
        `/api/menu/option-groups/${groupId}`,
        "PATCH",
        {
          name: editGroupName(),
          min_select: editGroupMinSelect(),
          max_select: editGroupMaxSelect(),
        },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "更新に失敗しました");
        return;
      }
      const updated = result.data;
      setGroups((prev) => prev.map((g) => (g.id === groupId ? updated : g)));
      setEditingGroupId(null);
    } finally {
      setGroupUpdating(false);
    }
  };

  const handleGroupDelete = async (groupId: string) => {
    setError("");
    const result = await apiFetch(`/api/menu/option-groups/${groupId}`, {
      method: "DELETE",
    });
    if (!result.ok) {
      setError(result.message ?? "削除に失敗しました");
      return;
    }
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    setOptionsByGroupId((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  };

  const handleOptionSubmit = async (e: SubmitEvent, groupId: string) => {
    e.preventDefault();
    setError("");
    setOptionSubmittingGroupId(groupId);
    try {
      const priceDelta = Number(optionPriceDelta()[groupId] ?? "0");
      const result = await jsonFetch<Option>(
        `/api/menu/option-groups/${groupId}/options`,
        "POST",
        { name: optionName()[groupId] ?? "", price_delta: priceDelta },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "エラーが発生しました");
        return;
      }
      const created = result.data;
      setOptionsByGroupId((prev) => ({
        ...prev,
        [groupId]: [...(prev[groupId] ?? []), created],
      }));
      setOptionName((prev) => ({ ...prev, [groupId]: "" }));
      setOptionPriceDelta((prev) => ({ ...prev, [groupId]: "" }));
    } finally {
      setOptionSubmittingGroupId(null);
    }
  };

  const startOptionEdit = (option: Option) => {
    setEditingOptionId(option.id);
    setEditOptionName(option.name);
    setEditOptionPriceDelta(String(option.price_delta));
    setError("");
  };

  const cancelOptionEdit = () => setEditingOptionId(null);

  const handleOptionEditSubmit = async (
    e: SubmitEvent,
    groupId: string,
    optionId: string,
  ) => {
    e.preventDefault();
    setError("");
    setOptionUpdating(true);
    try {
      const result = await jsonFetch<Option>(
        `/api/menu/option-groups/${groupId}/options/${optionId}`,
        "PATCH",
        {
          name: editOptionName(),
          price_delta: Number(editOptionPriceDelta()),
        },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "更新に失敗しました");
        return;
      }
      const updated = result.data;
      setOptionsByGroupId((prev) => ({
        ...prev,
        [groupId]: (prev[groupId] ?? []).map((o) =>
          o.id === optionId ? updated : o,
        ),
      }));
      setEditingOptionId(null);
    } finally {
      setOptionUpdating(false);
    }
  };

  const handleOptionDelete = async (groupId: string, optionId: string) => {
    setError("");
    const result = await apiFetch(
      `/api/menu/option-groups/${groupId}/options/${optionId}`,
      { method: "DELETE" },
    );
    if (!result.ok) {
      setError(result.message ?? "削除に失敗しました");
      return;
    }
    setOptionsByGroupId((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).filter((o) => o.id !== optionId),
    }));
  };

  return (
    <div class={styles.optionGroupManager}>
      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <section class={styles.section}>
        <h2>オプショングループを追加</h2>
        <p class={styles.hint}>
          「サイズ」「トッピング」のように、複数の商品で使い回せる選択肢のまとまりです。
        </p>
        <form onSubmit={handleGroupSubmit} class={styles.form}>
          <Field
            id="group-name"
            label="グループ名"
            value={groupName()}
            onInput={(e) => setGroupName(e.currentTarget.value)}
            placeholder="例：サイズ"
            required
            maxLength={100}
            disabled={groupSubmitting()}
          />
          <Field
            id="group-min"
            label="最小選択数"
            type="number"
            min={0}
            value={groupMinSelect()}
            onInput={(e) => setGroupMinSelect(Number(e.currentTarget.value))}
            disabled={groupSubmitting()}
          />
          <Field
            id="group-max"
            label="最大選択数"
            type="number"
            min={1}
            value={groupMaxSelect()}
            onInput={(e) => setGroupMaxSelect(Number(e.currentTarget.value))}
            disabled={groupSubmitting()}
          />
          <Button type="submit" disabled={groupSubmitting()}>
            {groupSubmitting() ? "追加中..." : "グループを追加"}
          </Button>
        </form>
      </section>

      <section class={styles.section}>
        <h2>オプショングループ一覧</h2>
        <Show
          when={groups().length > 0}
          fallback={<p class={styles.empty}>グループがまだありません</p>}
        >
          <ul class={styles.groupList}>
            <For each={groups()}>
              {(group) => (
                <li class={styles.groupCard}>
                  <Show
                    when={editingGroupId() === group.id}
                    fallback={
                      <div class={styles.groupHeaderRow}>
                        <span class={styles.groupName}>{group.name}</span>
                        <span class={styles.groupSelectRange}>
                          {group.min_select}〜{group.max_select}個選択
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`グループを編集 ${group.name}`}
                          onClick={() => startGroupEdit(group)}
                        >
                          編集
                        </Button>
                        <ConfirmDialog
                          triggerLabel="削除"
                          triggerSize="sm"
                          aria-label={`グループを削除 ${group.name}`}
                          title="オプショングループの削除"
                          description={`「${group.name}」を削除しますか？グループ内のオプションと、商品への割り当ても削除されます。過去の注文には影響しません。`}
                          onConfirm={() => handleGroupDelete(group.id)}
                        />
                      </div>
                    }
                  >
                    <form
                      class={styles.editForm}
                      onSubmit={(e) => handleGroupEditSubmit(e, group.id)}
                    >
                      <input
                        type="text"
                        value={editGroupName()}
                        onInput={(e) => setEditGroupName(e.currentTarget.value)}
                        required
                        maxLength={100}
                        disabled={groupUpdating()}
                        aria-label={`グループ名を編集 ${group.name}`}
                      />
                      <input
                        type="number"
                        min={0}
                        value={editGroupMinSelect()}
                        onInput={(e) =>
                          setEditGroupMinSelect(Number(e.currentTarget.value))
                        }
                        disabled={groupUpdating()}
                        aria-label={`最小選択数を編集 ${group.name}`}
                      />
                      <input
                        type="number"
                        min={1}
                        value={editGroupMaxSelect()}
                        onInput={(e) =>
                          setEditGroupMaxSelect(Number(e.currentTarget.value))
                        }
                        disabled={groupUpdating()}
                        aria-label={`最大選択数を編集 ${group.name}`}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={groupUpdating()}
                      >
                        {groupUpdating() ? "保存中..." : "保存"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={groupUpdating()}
                        onClick={cancelGroupEdit}
                      >
                        キャンセル
                      </Button>
                    </form>
                  </Show>

                  <Show
                    when={(optionsByGroupId()[group.id] ?? []).length > 0}
                    fallback={
                      <p class={styles.emptyOptions}>
                        オプションがまだありません
                      </p>
                    }
                  >
                    <ul class={styles.optionList}>
                      <For each={optionsByGroupId()[group.id] ?? []}>
                        {(option) => (
                          <li class={styles.optionRow}>
                            <Show
                              when={editingOptionId() === option.id}
                              fallback={
                                <>
                                  <span class={styles.optionName}>
                                    {option.name}
                                  </span>
                                  <span class={styles.optionPriceDelta}>
                                    {option.price_delta >= 0 ? "+" : ""}¥
                                    {option.price_delta.toLocaleString()}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`オプションを編集 ${group.name} / ${option.name}`}
                                    onClick={() => startOptionEdit(option)}
                                  >
                                    編集
                                  </Button>
                                  <ConfirmDialog
                                    triggerLabel="削除"
                                    triggerSize="sm"
                                    aria-label={`オプションを削除 ${group.name} / ${option.name}`}
                                    title="オプションの削除"
                                    description={`「${group.name}」の「${option.name}」を削除しますか？`}
                                    onConfirm={() =>
                                      handleOptionDelete(group.id, option.id)
                                    }
                                  />
                                </>
                              }
                            >
                              <form
                                class={styles.editForm}
                                onSubmit={(e) =>
                                  handleOptionEditSubmit(e, group.id, option.id)
                                }
                              >
                                <input
                                  type="text"
                                  value={editOptionName()}
                                  onInput={(e) =>
                                    setEditOptionName(e.currentTarget.value)
                                  }
                                  required
                                  maxLength={100}
                                  disabled={optionUpdating()}
                                  aria-label={`オプション名を編集 ${option.name}`}
                                />
                                <input
                                  type="number"
                                  value={editOptionPriceDelta()}
                                  onInput={(e) =>
                                    setEditOptionPriceDelta(
                                      e.currentTarget.value,
                                    )
                                  }
                                  required
                                  disabled={optionUpdating()}
                                  aria-label={`価格差を編集 ${option.name}`}
                                />
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={optionUpdating()}
                                >
                                  {optionUpdating() ? "保存中..." : "保存"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={optionUpdating()}
                                  onClick={cancelOptionEdit}
                                >
                                  キャンセル
                                </Button>
                              </form>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>

                  <form
                    class={styles.addOptionForm}
                    onSubmit={(e) => handleOptionSubmit(e, group.id)}
                  >
                    <input
                      type="text"
                      value={optionName()[group.id] ?? ""}
                      onInput={(e) =>
                        setOptionName((prev) => ({
                          ...prev,
                          [group.id]: e.currentTarget.value,
                        }))
                      }
                      placeholder="オプション名（例：大盛り）"
                      required
                      maxLength={100}
                      disabled={optionSubmittingGroupId() === group.id}
                      aria-label={`オプション名 ${group.name}`}
                    />
                    <input
                      type="number"
                      value={optionPriceDelta()[group.id] ?? ""}
                      onInput={(e) =>
                        setOptionPriceDelta((prev) => ({
                          ...prev,
                          [group.id]: e.currentTarget.value,
                        }))
                      }
                      placeholder="価格差（円）"
                      required
                      disabled={optionSubmittingGroupId() === group.id}
                      aria-label={`価格差 ${group.name}`}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={optionSubmittingGroupId() === group.id}
                    >
                      {optionSubmittingGroupId() === group.id
                        ? "追加中..."
                        : "オプションを追加"}
                    </Button>
                  </form>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}
