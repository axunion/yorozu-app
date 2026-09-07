import { apiFetch, jsonFetch, menuImageUrl } from "@yorozu/core/client";
import { Button, ConfirmDialog, ErrorAlert, Field, Select } from "@yorozu/ui";
import { createSignal, For, onMount, Show } from "solid-js";
import { downscaleImage } from "../lib/downscaleImage";
import styles from "./MenuManager.module.css";
import StatusBadge from "./StatusBadge";

type Category = {
  id: string;
  store_id: string;
  name: string;
  sort_order: number;
};

type Item = {
  id: string;
  store_id: string;
  name: string;
  price: number;
  is_available: boolean;
  category_id: string | null;
  sort_order: number;
  description: string | null;
  image_key: string | null;
  option_group_ids: string[];
};

type OptionGroup = {
  id: string;
  name: string;
};

export default function MenuManager() {
  const [categories, setCategories] = createSignal<Category[]>([]);
  const [items, setItems] = createSignal<Item[]>([]);
  const [optionGroups, setOptionGroups] = createSignal<OptionGroup[]>([]);
  const [error, setError] = createSignal("");

  const [catName, setCatName] = createSignal("");
  const [catSortOrder, setCatSortOrder] = createSignal(0);
  const [catSubmitting, setCatSubmitting] = createSignal(false);

  const [itemName, setItemName] = createSignal("");
  const [itemPrice, setItemPrice] = createSignal("");
  const [itemCategoryId, setItemCategoryId] = createSignal<string>("");
  const [itemIsAvailable, setItemIsAvailable] = createSignal(true);
  const [itemSortOrder, setItemSortOrder] = createSignal(0);
  const [itemDescription, setItemDescription] = createSignal("");
  const [itemSubmitting, setItemSubmitting] = createSignal(false);

  const [editingItemId, setEditingItemId] = createSignal<string | null>(null);
  const [editItemName, setEditItemName] = createSignal("");
  const [editItemPrice, setEditItemPrice] = createSignal("");
  const [editItemCategoryId, setEditItemCategoryId] = createSignal<string>("");
  const [editItemIsAvailable, setEditItemIsAvailable] = createSignal(true);
  const [editItemSortOrder, setEditItemSortOrder] = createSignal(0);
  const [editItemDescription, setEditItemDescription] = createSignal("");
  const [editItemOptionGroupIds, setEditItemOptionGroupIds] = createSignal<
    string[]
  >([]);
  const [itemUpdating, setItemUpdating] = createSignal(false);

  // Keyed by item id so concurrent uploads to different items don't clobber
  // each other's "uploading" state or preview.
  const [uploadingImageIds, setUploadingImageIds] = createSignal<
    Record<string, boolean>
  >({});
  const [pendingPreviews, setPendingPreviews] = createSignal<
    Record<string, string>
  >({});

  async function loadCategories() {
    const result = await apiFetch<Category[]>("/api/menu/categories");
    if (result.ok && result.data) {
      setCategories(result.data);
    } else {
      setError(result.message ?? "カテゴリの取得に失敗しました");
    }
  }

  async function loadItems() {
    const result = await apiFetch<Item[]>("/api/menu/items");
    if (result.ok && result.data) {
      setItems(result.data);
    } else {
      setError(result.message ?? "商品の取得に失敗しました");
    }
  }

  async function loadOptionGroups() {
    const result = await apiFetch<OptionGroup[]>("/api/menu/option-groups");
    if (result.ok && result.data) {
      setOptionGroups(result.data);
    } else {
      setError(result.message ?? "オプショングループの取得に失敗しました");
    }
  }

  onMount(async () => {
    await Promise.all([loadCategories(), loadItems(), loadOptionGroups()]);
  });

  function toggleOptionGroupId(
    ids: string[],
    setIds: (ids: string[]) => void,
    groupId: string,
    checked: boolean,
  ) {
    setIds(checked ? [...ids, groupId] : ids.filter((id) => id !== groupId));
  }

  const handleCategorySubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setCatSubmitting(true);
    try {
      const result = await jsonFetch<Category>("/api/menu/categories", "POST", {
        name: catName(),
        sort_order: catSortOrder(),
      });
      if (!result.ok) {
        setError(result.message ?? "エラーが発生しました");
        return;
      }
      setCatName("");
      setCatSortOrder(0);
      await loadCategories();
    } finally {
      setCatSubmitting(false);
    }
  };

  const handleCategoryDelete = async (id: string) => {
    setError("");
    const result = await apiFetch(`/api/menu/categories/${id}`, {
      method: "DELETE",
    });
    if (!result.ok) {
      setError(result.message ?? "削除に失敗しました");
      return;
    }
    await Promise.all([loadCategories(), loadItems()]);
  };

  const handleItemSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setItemSubmitting(true);
    try {
      const price = Number(itemPrice());
      const categoryId = itemCategoryId() || null;
      const result = await jsonFetch<Item>("/api/menu/items", "POST", {
        name: itemName(),
        price,
        is_available: itemIsAvailable(),
        category_id: categoryId,
        sort_order: itemSortOrder(),
        description: itemDescription() || null,
      });
      if (!result.ok) {
        setError(result.message ?? "エラーが発生しました");
        return;
      }
      setItemName("");
      setItemPrice("");
      setItemCategoryId("");
      setItemIsAvailable(true);
      setItemSortOrder(0);
      setItemDescription("");
      await loadItems();
    } finally {
      setItemSubmitting(false);
    }
  };

  const handleItemDelete = async (id: string) => {
    setError("");
    const result = await apiFetch(`/api/menu/items/${id}`, {
      method: "DELETE",
    });
    if (!result.ok) {
      setError(result.message ?? "削除に失敗しました");
      return;
    }
    // Update the list in place rather than reloading: a full reload would
    // replace every row's object identity, tearing down and rebuilding any
    // other item's inline edit form that happens to be open.
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleToggleAvailability = async (item: Item) => {
    setError("");
    const result = await jsonFetch<Item>(
      `/api/menu/items/${item.id}`,
      "PATCH",
      {
        name: item.name,
        price: item.price,
        is_available: !item.is_available,
        category_id: item.category_id,
        sort_order: item.sort_order,
      },
    );
    if (!result.ok || !result.data) {
      setError(result.message ?? "更新に失敗しました");
      return;
    }
    const updated = result.data;
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
  };

  const startItemEdit = async (item: Item) => {
    setEditingItemId(item.id);
    setEditItemName(item.name);
    setEditItemPrice(String(item.price));
    setEditItemCategoryId(item.category_id ?? "");
    setEditItemIsAvailable(item.is_available);
    setEditItemSortOrder(item.sort_order);
    setEditItemDescription(item.description ?? "");
    setEditItemOptionGroupIds(item.option_group_ids ?? []);
    setError("");
    // Option groups live in a separate component (OptionGroupManager) with
    // its own copy of this list — refetch so a group created/renamed/deleted
    // there is reflected in these checkboxes without a full page reload.
    await loadOptionGroups();
  };

  const cancelItemEdit = () => {
    setEditingItemId(null);
  };

  const handleItemEditSubmit = async (e: SubmitEvent, itemId: string) => {
    e.preventDefault();
    setError("");
    setItemUpdating(true);
    try {
      const result = await jsonFetch<Item>(
        `/api/menu/items/${itemId}`,
        "PATCH",
        {
          name: editItemName(),
          price: Number(editItemPrice()),
          is_available: editItemIsAvailable(),
          category_id: editItemCategoryId() || null,
          sort_order: editItemSortOrder(),
          description: editItemDescription() || null,
          option_group_ids: editItemOptionGroupIds(),
        },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "更新に失敗しました");
        return;
      }
      const updated = result.data;
      setItems((prev) => prev.map((i) => (i.id === itemId ? updated : i)));
      setEditingItemId(null);
    } finally {
      setItemUpdating(false);
    }
  };

  const handleImageChange = async (
    e: Event & { currentTarget: HTMLInputElement },
    item: Item,
  ) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;

    setError("");
    setUploadingImageIds((prev) => ({ ...prev, [item.id]: true }));
    let previewUrl: string | null = null;
    try {
      const blob = await downscaleImage(file);
      previewUrl = URL.createObjectURL(blob);
      setPendingPreviews((prev) => ({
        ...prev,
        [item.id]: previewUrl as string,
      }));

      const result = await apiFetch<Item>(`/api/menu/items/${item.id}/image`, {
        method: "PUT",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      if (!result.ok || !result.data) {
        setError(result.message ?? "画像のアップロードに失敗しました");
        return;
      }
      const updated = result.data;
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch {
      setError("画像の処理に失敗しました。別の画像をお試しください。");
    } finally {
      setUploadingImageIds((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setPendingPreviews((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }
  };

  const handleImageRemove = async (item: Item) => {
    setError("");
    const result = await apiFetch<Item>(`/api/menu/items/${item.id}/image`, {
      method: "DELETE",
    });
    if (!result.ok || !result.data) {
      setError(result.message ?? "画像の削除に失敗しました");
      return;
    }
    const updated = result.data;
    setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
  };

  return (
    <div class={styles.menuManager}>
      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <section class={styles.menuSection}>
        <h2>メニューカテゴリ</h2>
        <form onSubmit={handleCategorySubmit} class={styles.menuForm}>
          <Field
            id="cat-name"
            label="カテゴリ名"
            value={catName()}
            onInput={(e) => setCatName(e.currentTarget.value)}
            placeholder="例：ドリンク"
            required
            maxLength={100}
            disabled={catSubmitting()}
          />
          <Field
            id="cat-sort"
            label="表示順"
            type="number"
            min={0}
            value={catSortOrder()}
            onInput={(e) => setCatSortOrder(Number(e.currentTarget.value))}
            disabled={catSubmitting()}
          />
          <Button type="submit" disabled={catSubmitting()}>
            {catSubmitting() ? "追加中..." : "カテゴリを追加"}
          </Button>
        </form>
        <Show
          when={categories().length > 0}
          fallback={<p class={styles.empty}>カテゴリがまだありません</p>}
        >
          <ul class={styles.menuList}>
            <For each={categories()}>
              {(cat) => (
                <li class={styles.menuListItem}>
                  <span class={styles.itemName}>{cat.name}</span>
                  <span class={styles.itemSort}>順: {cat.sort_order}</span>
                  <ConfirmDialog
                    triggerLabel="削除"
                    aria-label={`削除 ${cat.name}`}
                    title="カテゴリの削除"
                    description={`「${cat.name}」を削除しますか？この操作は元に戻せません。`}
                    onConfirm={() => handleCategoryDelete(cat.id)}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section class={styles.menuSection}>
        <h2>メニュー商品</h2>
        <form onSubmit={handleItemSubmit} class={styles.menuForm}>
          <Field
            id="item-name"
            label="商品名"
            value={itemName()}
            onInput={(e) => setItemName(e.currentTarget.value)}
            placeholder="例：ラテ"
            required
            maxLength={100}
            disabled={itemSubmitting()}
          />
          <Field
            id="item-price"
            label="価格（円）"
            type="number"
            min={1}
            value={itemPrice()}
            onInput={(e) => setItemPrice(e.currentTarget.value)}
            placeholder="例：500"
            required
            disabled={itemSubmitting()}
          />
          <div class={styles.field}>
            <label for="item-category">カテゴリ</label>
            <Select
              id="item-category"
              aria-label="カテゴリ"
              options={categories().map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              value={itemCategoryId() || null}
              onChange={setItemCategoryId}
              placeholder="-- なし --"
              disabled={itemSubmitting()}
            />
          </div>
          <div class={[styles.field, styles.fieldCheck].join(" ")}>
            <label>
              <input
                type="checkbox"
                checked={itemIsAvailable()}
                onChange={(e) => setItemIsAvailable(e.currentTarget.checked)}
                disabled={itemSubmitting()}
              />
              提供中
            </label>
          </div>
          <Field
            id="item-sort"
            label="表示順"
            type="number"
            min={0}
            value={itemSortOrder()}
            onInput={(e) => setItemSortOrder(Number(e.currentTarget.value))}
            disabled={itemSubmitting()}
          />
          <div class={styles.field}>
            <label for="item-description">商品説明（任意）</label>
            <textarea
              id="item-description"
              value={itemDescription()}
              onInput={(e) => setItemDescription(e.currentTarget.value)}
              placeholder="例：香ばしい米粉を使用したから揚げ"
              maxLength={500}
              disabled={itemSubmitting()}
            />
          </div>
          <Button type="submit" disabled={itemSubmitting()}>
            {itemSubmitting() ? "追加中..." : "商品を追加"}
          </Button>
        </form>
        <Show when={optionGroups().length > 0}>
          <p class={styles.hint}>
            オプショングループの割り当ては、商品を追加した後に「編集」から行えます。
          </p>
        </Show>
        <Show
          when={items().length > 0}
          fallback={<p class={styles.empty}>商品がまだありません</p>}
        >
          <ul class={styles.menuList}>
            <For each={items()}>
              {(item) => {
                const itemCategoryName = () =>
                  categories().find((c) => c.id === item.category_id)?.name ??
                  "なし";
                const attachedGroupNames = () =>
                  (item.option_group_ids ?? [])
                    .map((id) => optionGroups().find((g) => g.id === id)?.name)
                    .filter((name): name is string => Boolean(name));
                const thumbSrc = () =>
                  pendingPreviews()[item.id] ??
                  (item.image_key ? menuImageUrl(item.image_key) : null);
                return (
                  <li
                    class={`${styles.menuListItem} ${styles.itemListItem}${!item.is_available ? ` ${styles.menuListItemUnavailable ?? ""}` : ""}`}
                  >
                    <Show when={thumbSrc()}>
                      <div class={styles.itemThumb}>
                        <img src={thumbSrc() ?? ""} alt="" />
                      </div>
                    </Show>
                    <div class={styles.itemInfo}>
                      <Show
                        when={editingItemId() === item.id}
                        fallback={
                          <>
                            <div class={styles.itemHeaderRow}>
                              <span class={styles.itemName}>{item.name}</span>
                              <span class={styles.itemPrice}>
                                ¥{item.price.toLocaleString()}
                              </span>
                              <span class={styles.itemCategory}>
                                {itemCategoryName()}
                              </span>
                              <StatusBadge
                                tone={item.is_available ? "success" : "danger"}
                              >
                                {item.is_available ? "販売中" : "品切れ"}
                              </StatusBadge>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`商品を編集 ${item.name}`}
                                onClick={() => startItemEdit(item)}
                              >
                                編集
                              </Button>
                            </div>
                            <Show when={item.description}>
                              <p class={styles.itemDescription}>
                                {item.description}
                              </p>
                            </Show>
                            <Show when={attachedGroupNames().length > 0}>
                              <p class={styles.itemOptionGroups}>
                                オプション: {attachedGroupNames().join("、")}
                              </p>
                            </Show>
                          </>
                        }
                      >
                        <form
                          class={styles.editForm}
                          onSubmit={(e) => handleItemEditSubmit(e, item.id)}
                        >
                          <input
                            type="text"
                            value={editItemName()}
                            onInput={(e) =>
                              setEditItemName(e.currentTarget.value)
                            }
                            required
                            maxLength={100}
                            disabled={itemUpdating()}
                            aria-label={`商品名を編集 ${item.name}`}
                          />
                          <input
                            type="number"
                            min={1}
                            value={editItemPrice()}
                            onInput={(e) =>
                              setEditItemPrice(e.currentTarget.value)
                            }
                            required
                            disabled={itemUpdating()}
                            aria-label={`価格を編集 ${item.name}`}
                          />
                          <Select
                            options={categories().map((c) => ({
                              value: c.id,
                              label: c.name,
                            }))}
                            value={editItemCategoryId() || null}
                            onChange={setEditItemCategoryId}
                            placeholder="-- なし --"
                            disabled={itemUpdating()}
                            aria-label={`カテゴリを編集 ${item.name}`}
                          />
                          <label class={styles.editCheck}>
                            <input
                              type="checkbox"
                              checked={editItemIsAvailable()}
                              onChange={(e) =>
                                setEditItemIsAvailable(e.currentTarget.checked)
                              }
                              disabled={itemUpdating()}
                            />
                            提供中
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={editItemSortOrder()}
                            onInput={(e) =>
                              setEditItemSortOrder(
                                Number(e.currentTarget.value),
                              )
                            }
                            disabled={itemUpdating()}
                            aria-label={`表示順を編集 ${item.name}`}
                          />
                          <textarea
                            value={editItemDescription()}
                            onInput={(e) =>
                              setEditItemDescription(e.currentTarget.value)
                            }
                            maxLength={500}
                            placeholder="商品説明（任意）"
                            disabled={itemUpdating()}
                            aria-label={`商品説明を編集 ${item.name}`}
                          />
                          <Show when={optionGroups().length > 0}>
                            <fieldset class={styles.optionGroupFieldset}>
                              <legend>オプショングループ</legend>
                              <For each={optionGroups()}>
                                {(group) => (
                                  <label class={styles.editCheck}>
                                    <input
                                      type="checkbox"
                                      checked={editItemOptionGroupIds().includes(
                                        group.id,
                                      )}
                                      onChange={(e) =>
                                        toggleOptionGroupId(
                                          editItemOptionGroupIds(),
                                          setEditItemOptionGroupIds,
                                          group.id,
                                          e.currentTarget.checked,
                                        )
                                      }
                                      disabled={itemUpdating()}
                                    />
                                    {group.name}
                                  </label>
                                )}
                              </For>
                            </fieldset>
                          </Show>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={itemUpdating()}
                          >
                            {itemUpdating() ? "保存中..." : "保存"}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={itemUpdating()}
                            onClick={cancelItemEdit}
                          >
                            キャンセル
                          </Button>
                        </form>
                      </Show>
                    </div>
                    <div class={styles.itemActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleToggleAvailability(item)}
                      >
                        {item.is_available ? "停止" : "再開"}
                      </Button>
                      <label class={styles.imageUploadLabel}>
                        {uploadingImageIds()[item.id]
                          ? "アップロード中..."
                          : item.image_key
                            ? "画像を変更"
                            : "画像を追加"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          class={styles.visuallyHidden}
                          onChange={(e) => handleImageChange(e, item)}
                          disabled={uploadingImageIds()[item.id] === true}
                          aria-label={`画像を選択 ${item.name}`}
                        />
                      </label>
                      <Show when={item.image_key}>
                        <ConfirmDialog
                          triggerLabel="画像を削除"
                          triggerVariant="secondary"
                          triggerSize="sm"
                          aria-label={`画像を削除 ${item.name}`}
                          title="画像の削除"
                          description={`「${item.name}」の画像を削除しますか？`}
                          confirmLabel="削除する"
                          onConfirm={() => handleImageRemove(item)}
                        />
                      </Show>
                      <ConfirmDialog
                        triggerLabel="削除"
                        aria-label={`削除 ${item.name}`}
                        title="商品の削除"
                        description={`「${item.name}」を削除しますか？この操作は元に戻せません。`}
                        onConfirm={() => handleItemDelete(item.id)}
                      />
                    </div>
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
