import { menuImageUrl } from "@yorozu/core/client";
import { Button } from "@yorozu/ui";
import { createSignal, For, Show } from "solid-js";
import type { CartEntry } from "../lib/cart";
import ItemDetailSheet from "./ItemDetailSheet";
import styles from "./MenuList.module.css";
import type { MenuGroup, MenuItem } from "./OrderScreen";
import { categoryElementId } from "./OrderScreen";

export default function MenuList(props: {
  groups: MenuGroup[];
  /** True once the bill is requested: the order accepts no more items. */
  locked: boolean;
  onAddToCart: (entry: CartEntry) => void;
}) {
  const [detailItem, setDetailItem] = createSignal<MenuItem | null>(null);

  function addPlainItem(item: MenuItem) {
    props.onAddToCart({
      menu_item_id: item.id,
      name: item.name,
      unit_price: item.price,
      quantity: 1,
      option_ids: [],
      option_labels: [],
      note: null,
    });
  }

  return (
    <section class={styles.section}>
      <h2 class={styles.heading}>メニュー</h2>

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
                      <div class={styles.itemOrder}>
                        <Show
                          when={item.option_groups.length === 0}
                          fallback={
                            <Button
                              variant="primary"
                              size="sm"
                              class={styles.orderButton}
                              aria-label={`${item.name}のオプションを選ぶ`}
                              disabled={props.locked}
                              onClick={() => setDetailItem(item)}
                            >
                              オプションを選ぶ
                            </Button>
                          }
                        >
                          <Button
                            variant="primary"
                            size="sm"
                            class={styles.orderButton}
                            aria-label={`${item.name}をカートに追加`}
                            disabled={props.locked}
                            onClick={() => addPlainItem(item)}
                          >
                            カートに追加
                          </Button>
                        </Show>
                      </div>
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
            onAddToCart={props.onAddToCart}
          />
        )}
      </Show>
    </section>
  );
}
