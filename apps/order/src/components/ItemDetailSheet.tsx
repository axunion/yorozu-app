// Namespace import, not `{ Dialog }`: Kobalte builds both Dialog and
// AlertDialog by Object.assign onto the same root, so `Dialog.Content`
// becomes the alertdialog content once @yorozu/ui's ConfirmDialog loads.
import * as Dialog from "@kobalte/core/dialog";
import { Button } from "@yorozu/ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import { type CartEntry, MAX_LINE_QUANTITY } from "../lib/cart";
import styles from "./ItemDetailSheet.module.css";
import type { MenuItem, MenuItemOptionGroup } from "./OrderScreen";
import QuantityStepper from "./QuantityStepper";

/** Formats a price delta as a signed yen amount, or "" when it's 0. */
function formatDelta(delta: number): string {
  if (delta === 0) return "";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}¥${Math.abs(delta).toLocaleString()}`;
}

function isGroupSatisfied(
  group: MenuItemOptionGroup,
  selected: string[],
): boolean {
  return (
    selected.length >= group.min_select && selected.length <= group.max_select
  );
}

export default function ItemDetailSheet(props: {
  item: MenuItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToCart: (entry: CartEntry) => void;
}) {
  const [selections, setSelections] = createSignal<Record<string, string[]>>(
    {},
  );
  const [note, setNote] = createSignal("");
  const [quantity, setQuantity] = createSignal(1);

  const selectedFor = (groupId: string) => selections()[groupId] ?? [];

  // A group with no options has nothing to select and can never be
  // satisfied if required, so it's excluded rather than blocking submission.
  const visibleGroups = createMemo(() =>
    props.item.option_groups.filter((g) => g.options.length > 0),
  );

  const allGroupsSatisfied = createMemo(() =>
    visibleGroups().every((g) => isGroupSatisfied(g, selectedFor(g.id))),
  );

  const selectedOptions = createMemo(() =>
    visibleGroups().flatMap((g) =>
      g.options.filter((o) => selectedFor(g.id).includes(o.id)),
    ),
  );

  const unitPrice = createMemo(
    () =>
      props.item.price +
      selectedOptions().reduce((sum, o) => sum + o.price_delta, 0),
  );

  function reset() {
    setSelections({});
    setNote("");
    setQuantity(1);
  }

  function close() {
    reset();
    props.onOpenChange(false);
  }

  function selectRadio(group: MenuItemOptionGroup, optionId: string | null) {
    setSelections((prev) => ({
      ...prev,
      [group.id]: optionId ? [optionId] : [],
    }));
  }

  function toggleCheckbox(
    group: MenuItemOptionGroup,
    optionId: string,
    checked: boolean,
  ) {
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      const next = checked
        ? [...current, optionId]
        : current.filter((id) => id !== optionId);
      return { ...prev, [group.id]: next };
    });
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!allGroupsSatisfied()) return;
    // Group order, so the API snapshots options in the order they're shown.
    const options = selectedOptions();
    props.onAddToCart({
      menu_item_id: props.item.id,
      name: props.item.name,
      unit_price: unitPrice(),
      quantity: quantity(),
      option_ids: options.map((o) => o.id),
      option_labels: options.map((o) => o.name),
      note: note().trim() || null,
    });
    close();
  }

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
    >
      <Dialog.Portal>
        <Dialog.Overlay class={styles.overlay} />
        <div class={styles.positioner}>
          <Dialog.Content class={styles.content}>
            <form onSubmit={handleSubmit} class={styles.form}>
              <div class={styles.body}>
                <Dialog.Title class={styles.title}>
                  {props.item.name}
                </Dialog.Title>
                <Show when={props.item.description}>
                  <p class={styles.description}>{props.item.description}</p>
                </Show>

                <For each={visibleGroups()}>
                  {(group) => (
                    <fieldset class={styles.group}>
                      <legend class={styles.groupLegend}>
                        {group.name}
                        <span class={styles.groupHint}>
                          {group.min_select > 0 ? "必須 / " : ""}
                          {group.max_select}個まで
                        </span>
                      </legend>
                      <Show
                        when={group.max_select === 1}
                        fallback={
                          <For each={group.options}>
                            {(option) => {
                              const checked = () =>
                                selectedFor(group.id).includes(option.id);
                              const atMax = () =>
                                selectedFor(group.id).length >=
                                group.max_select;
                              return (
                                <label class={styles.optionRow}>
                                  <input
                                    type="checkbox"
                                    checked={checked()}
                                    disabled={!checked() && atMax()}
                                    onChange={(e) =>
                                      toggleCheckbox(
                                        group,
                                        option.id,
                                        e.currentTarget.checked,
                                      )
                                    }
                                  />
                                  <span class={styles.optionName}>
                                    {option.name}
                                  </span>
                                  <span class={styles.optionDelta}>
                                    {formatDelta(option.price_delta)}
                                  </span>
                                </label>
                              );
                            }}
                          </For>
                        }
                      >
                        <Show when={group.min_select === 0}>
                          <label class={styles.optionRow}>
                            <input
                              type="radio"
                              name={`option-group-${group.id}`}
                              checked={selectedFor(group.id).length === 0}
                              onChange={() => selectRadio(group, null)}
                            />
                            <span class={styles.optionName}>選択しない</span>
                          </label>
                        </Show>
                        <For each={group.options}>
                          {(option) => (
                            <label class={styles.optionRow}>
                              <input
                                type="radio"
                                name={`option-group-${group.id}`}
                                checked={selectedFor(group.id).includes(
                                  option.id,
                                )}
                                onChange={() => selectRadio(group, option.id)}
                              />
                              <span class={styles.optionName}>
                                {option.name}
                              </span>
                              <span class={styles.optionDelta}>
                                {formatDelta(option.price_delta)}
                              </span>
                            </label>
                          )}
                        </For>
                      </Show>
                    </fieldset>
                  )}
                </For>

                <div class={styles.field}>
                  <label for="item-detail-note">ご要望（任意）</label>
                  <textarea
                    id="item-detail-note"
                    value={note()}
                    onInput={(e) => setNote(e.currentTarget.value)}
                    maxLength={200}
                    placeholder="例：氷少なめ"
                  />
                </div>
              </div>

              <div class={styles.footer}>
                <QuantityStepper
                  itemName={props.item.name}
                  quantity={quantity()}
                  decreaseDisabled={quantity() <= 1}
                  increaseDisabled={quantity() >= MAX_LINE_QUANTITY}
                  onDecrease={() => setQuantity((q) => Math.max(1, q - 1))}
                  onIncrease={() =>
                    setQuantity((q) => Math.min(MAX_LINE_QUANTITY, q + 1))
                  }
                />
                <Button
                  type="button"
                  variant="secondary"
                  class={styles.footerButton}
                  onClick={close}
                >
                  キャンセル
                </Button>
                <Button
                  type="submit"
                  class={styles.footerButton}
                  disabled={!allGroupsSatisfied()}
                >
                  {`¥${(unitPrice() * quantity()).toLocaleString()} をカートに追加`}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
