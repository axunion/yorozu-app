import { menuImageUrl } from "@yorozu/core/client";
import { Button, ErrorAlert } from "@yorozu/ui";
import { createSignal, For, onCleanup, Show } from "solid-js";
import ItemDetailSheet from "./ItemDetailSheet";
import styles from "./MenuList.module.css";
import type { AddItemsInput, MenuGroup, MenuItem } from "./OrderScreen";
import { categoryElementId } from "./OrderScreen";
import QuantityStepper from "./QuantityStepper";

export default function MenuList(props: {
  groups: MenuGroup[];
  onAddItems: (
    items: AddItemsInput,
  ) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [quantities, setQuantities] = createSignal<Record<string, number>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal("");
  const [detailItem, setDetailItem] = createSignal<MenuItem | null>(null);

  let successTimeoutId: ReturnType<typeof setTimeout> | undefined;
  function showSuccessTemporarily() {
    setSuccess("注文しました！");
    clearTimeout(successTimeoutId);
    successTimeoutId = setTimeout(() => setSuccess(""), 2000);
  }
  onCleanup(() => clearTimeout(successTimeoutId));

  function getQuantity(itemId: string): number {
    return quantities()[itemId] ?? 1;
  }

  function setQuantity(itemId: string, value: number) {
    setQuantities((prev) => ({ ...prev, [itemId]: Math.max(1, value) }));
  }

  async function handleOrderItem(itemId: string) {
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const qty = getQuantity(itemId);
      const result = await props.onAddItems([
        { menu_item_id: itemId, quantity: qty },
      ]);
      if (!result.ok) {
        setError(result.message ?? "注文に失敗しました。");
      } else {
        setQuantities((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        showSuccessTemporarily();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDetailAddItems(
    items: AddItemsInput,
  ): Promise<{ ok: boolean; message?: string }> {
    setError("");
    const result = await props.onAddItems(items);
    if (result.ok) {
      showSuccessTemporarily();
    }
    return result;
  }

  return (
    <section class={styles.section}>
      <h2 class={styles.heading}>メニュー</h2>

      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <Show when={success()}>
        <p class={styles.alertSuccess} aria-live="polite">
          {success()}
        </p>
      </Show>

      <Show
        when={props.groups.length > 0}
        fallback={<p class={styles.empty}>メニューがまだ登録されていません</p>}
      >
        <For each={props.groups}>
          {(group) => (
            <div class={styles.group} id={categoryElementId(group.key)}>
              <h3 class={styles.categoryLabel}>{group.categoryName}</h3>
              <ul class={styles.list}>
                <For each={group.items}>
                  {(item) => (
                    <li class={styles.item}>
                      <Show when={item.image_key}>
                        <div class={styles.itemThumb}>
                          <img
                            src={menuImageUrl(item.image_key ?? "")}
                            alt={item.name}
                            loading="lazy"
                          />
                        </div>
                      </Show>
                      <div class={styles.itemInfo}>
                        <span class={styles.itemName}>{item.name}</span>
                        <Show when={item.description}>
                          <p class={styles.itemDescription}>
                            {item.description}
                          </p>
                        </Show>
                        <span class={styles.itemPrice}>
                          ¥{item.price.toLocaleString()}
                        </span>
                      </div>
                      <Show
                        when={item.option_groups.length === 0}
                        fallback={
                          <div class={styles.itemOrder}>
                            <Button
                              variant="primary"
                              size="sm"
                              aria-label={`${item.name}のオプションを選ぶ`}
                              onClick={() => setDetailItem(item)}
                            >
                              オプションを選ぶ
                            </Button>
                          </div>
                        }
                      >
                        <div class={styles.itemOrder}>
                          <QuantityStepper
                            itemName={item.name}
                            quantity={getQuantity(item.id)}
                            decreaseDisabled={
                              submitting() || getQuantity(item.id) <= 1
                            }
                            increaseDisabled={submitting()}
                            onDecrease={() =>
                              setQuantity(item.id, getQuantity(item.id) - 1)
                            }
                            onIncrease={() =>
                              setQuantity(item.id, getQuantity(item.id) + 1)
                            }
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            aria-label={`${item.name}を注文する`}
                            onClick={() => handleOrderItem(item.id)}
                            disabled={submitting()}
                          >
                            {submitting() ? "注文中..." : "注文する"}
                          </Button>
                        </div>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </Show>

      <Show when={detailItem()}>
        {(item) => (
          <ItemDetailSheet
            item={item()}
            open={true}
            onOpenChange={(open) => !open && setDetailItem(null)}
            onAddItems={handleDetailAddItems}
          />
        )}
      </Show>
    </section>
  );
}
