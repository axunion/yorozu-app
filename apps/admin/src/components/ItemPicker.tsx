import { Button } from "@yorozu/ui";
import { createSignal, For, Show } from "solid-js";
import { type DraftEntry, MAX_LINE_QUANTITY } from "../lib/draftOrder";
import styles from "./StaffOrderEntry.module.css";

export type Option = { id: string; name: string; price_delta: number };
export type OptionGroup = {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  options: Option[];
};
export type MenuItem = {
  id: string;
  category_id: string | null;
  name: string;
  price: number;
  option_groups: OptionGroup[];
};
const formatYen = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;

/**
 * Inline panel under a menu row: options, quantity and a note for one item.
 */
export default function ItemPicker(props: {
  id: string;
  item: MenuItem;
  onAdd: (entry: DraftEntry) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = createSignal<Record<string, string[]>>({});
  const [quantity, setQuantity] = createSignal(1);
  const [note, setNote] = createSignal("");

  const groups = () => props.item.option_groups.filter((g) => g.options.length);
  const chosen = (groupId: string) => selected()[groupId] ?? [];
  const valid = () =>
    groups().every(
      (g) =>
        chosen(g.id).length >= g.min_select &&
        chosen(g.id).length <= g.max_select,
    );
  const chosenOptions = () =>
    groups().flatMap((g) =>
      g.options.filter((o) => chosen(g.id).includes(o.id)),
    );

  function toggle(group: OptionGroup, optionId: string, on: boolean) {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      const next =
        group.max_select === 1
          ? on
            ? [optionId]
            : []
          : on
            ? [...current, optionId]
            : current.filter((id) => id !== optionId);
      return { ...prev, [group.id]: next };
    });
  }

  function handleAdd() {
    const options = chosenOptions();
    props.onAdd({
      menu_item_id: props.item.id,
      name: props.item.name,
      unit_price:
        props.item.price + options.reduce((sum, o) => sum + o.price_delta, 0),
      quantity: quantity(),
      option_ids: options.map((o) => o.id),
      option_labels: options.map((o) => o.name),
      note: note().trim() || null,
    });
  }

  return (
    <div id={props.id} class={styles.picker}>
      <For each={groups()}>
        {(group) => (
          <fieldset class={styles.pickerGroup}>
            <legend>
              {group.name}
              <span class={styles.pickerHint}>
                {group.min_select > 0 ? "必須 / " : ""}
                {group.max_select}個まで
              </span>
            </legend>
            <For each={group.options}>
              {(option) => (
                <label class={styles.pickerOption}>
                  <input
                    // Radios only when one choice is required: a checked radio
                    // can't be unchecked, which would trap an optional pick.
                    type={
                      group.min_select > 0 && group.max_select === 1
                        ? "radio"
                        : "checkbox"
                    }
                    name={`staff-entry-${props.item.id}-${group.id}`}
                    checked={chosen(group.id).includes(option.id)}
                    disabled={
                      group.max_select > 1 &&
                      !chosen(group.id).includes(option.id) &&
                      chosen(group.id).length >= group.max_select
                    }
                    onChange={(e) =>
                      toggle(group, option.id, e.currentTarget.checked)
                    }
                  />
                  {option.name}
                  <Show when={option.price_delta !== 0}>
                    <span class={styles.pickerHint}>
                      {option.price_delta > 0 ? "+" : "-"}
                      {formatYen(Math.abs(option.price_delta))}
                    </span>
                  </Show>
                </label>
              )}
            </For>
          </fieldset>
        )}
      </For>
      <div class={styles.pickerRow}>
        <label class={styles.pickerField}>
          数量
          <input
            type="number"
            min="1"
            max={MAX_LINE_QUANTITY}
            value={quantity()}
            onChange={(e) => {
              const clamped = Math.min(
                MAX_LINE_QUANTITY,
                Math.max(1, Math.trunc(Number(e.currentTarget.value)) || 1),
              );
              setQuantity(clamped);
              // Written back explicitly: an unchanged signal won't re-render
              // the out-of-range text the user typed.
              e.currentTarget.value = String(clamped);
            }}
          />
        </label>
        <label class={`${styles.pickerField} ${styles.pickerNote}`}>
          メモ（任意）
          <input
            type="text"
            maxLength={200}
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
          />
        </label>
      </div>
      <div class={styles.pickerActions}>
        <Button size="sm" variant="secondary" onClick={() => props.onCancel()}>
          閉じる
        </Button>
        <Button size="sm" disabled={!valid()} onClick={handleAdd}>
          {props.item.name}を追加
        </Button>
      </div>
    </div>
  );
}
