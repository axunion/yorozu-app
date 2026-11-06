import { apiFetch, jsonFetch } from "@yorozu/core/client";
import { Button, ErrorAlert, Select } from "@yorozu/ui";
import { createMemo, createSignal, For, Index, onMount, Show } from "solid-js";
import {
  addDraftLine,
  type DraftEntry,
  type DraftLine,
  draftTotal,
  MAX_LINE_QUANTITY,
  setDraftQuantity,
} from "../lib/draftOrder";
import ItemPicker, { formatYen, type MenuItem } from "./ItemPicker";
import styles from "./StaffOrderEntry.module.css";

type EntryData = {
  seats: { id: string; name: string }[];
  menu: {
    categories: { id: string; name: string }[];
    items: MenuItem[];
  };
};

/**
 * A dense, board-side picker for entering an order on a guest's behalf.
 * Items without options add in one tap; 「詳細」 opens an inline panel for
 * options, quantity and a note. Nothing is sent until 注文を送信.
 */
export default function StaffOrderEntry() {
  const [data, setData] = createSignal<EntryData | null>(null);
  const [loadError, setLoadError] = createSignal("");
  const [seatId, setSeatId] = createSignal<string | null>(null);
  const [lines, setLines] = createSignal<DraftLine[]>([]);
  const [openItemId, setOpenItemId] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal("");

  onMount(async () => {
    const result = await apiFetch<EntryData>("/api/admin/orders/entry");
    if (result.ok && result.data) {
      setData(result.data);
    } else {
      setLoadError(result.message ?? "メニューの取得に失敗しました。");
    }
  });

  const groups = createMemo(() => {
    const entry = data();
    if (!entry) return [];
    const known = new Set(entry.menu.categories.map((c) => c.id));
    return [
      ...entry.menu.categories.map((c) => ({
        key: c.id,
        name: c.name,
        items: entry.menu.items.filter((i) => i.category_id === c.id),
      })),
      {
        key: "uncategorized",
        name: "その他",
        items: entry.menu.items.filter(
          (i) => i.category_id === null || !known.has(i.category_id),
        ),
      },
    ].filter((g) => g.items.length > 0);
  });

  const seatName = () =>
    data()?.seats.find((s) => s.id === seatId())?.name ?? "";

  function add(entry: DraftEntry) {
    setSuccess("");
    setLines((prev) => addDraftLine(prev, entry));
  }

  async function submit() {
    const seat = seatId();
    if (!seat) return;
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const result = await jsonFetch(
        `/api/admin/orders/seats/${seat}/items`,
        "POST",
        {
          items: lines().map((line) => ({
            menu_item_id: line.menu_item_id,
            quantity: line.quantity,
            option_ids: line.option_ids,
            note: line.note,
          })),
        },
      );
      if (!result.ok) {
        setError(result.message ?? "注文の送信に失敗しました。");
        return;
      }
      setLines([]);
      setSuccess(`${seatName()}に注文を送信しました。`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class={styles.entry}>
      <Show when={loadError()}>
        <ErrorAlert>{loadError()}</ErrorAlert>
      </Show>
      <Show when={data()}>
        {(entry) => (
          <>
            <section class={styles.section}>
              <label class={styles.seatLabel} for="staff-entry-seat">
                座席
              </label>
              <Select
                id="staff-entry-seat"
                aria-label="座席"
                placeholder="座席を選ぶ"
                options={entry().seats.map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
                value={seatId()}
                onChange={setSeatId}
              />
            </section>

            <section class={styles.section}>
              <h2 class={styles.heading}>メニュー</h2>
              <Show
                when={groups().length > 0}
                fallback={
                  <p class={styles.empty}>注文できる商品がありません</p>
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <div class={styles.group}>
                      <h3 class={styles.groupLabel}>{group.name}</h3>
                      <ul class={styles.items}>
                        <For each={group.items}>
                          {(item) => (
                            <li class={styles.item}>
                              <div class={styles.itemRow}>
                                <span class={styles.itemName}>{item.name}</span>
                                <span class={styles.itemPrice}>
                                  {formatYen(item.price)}
                                </span>
                                <Show when={item.option_groups.length === 0}>
                                  <Button
                                    size="sm"
                                    aria-label={`${item.name}を追加`}
                                    onClick={() =>
                                      add({
                                        menu_item_id: item.id,
                                        name: item.name,
                                        unit_price: item.price,
                                        quantity: 1,
                                        option_ids: [],
                                        option_labels: [],
                                        note: null,
                                      })
                                    }
                                  >
                                    追加
                                  </Button>
                                </Show>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  aria-label={`${item.name}の詳細`}
                                  aria-expanded={openItemId() === item.id}
                                  aria-controls={`staff-entry-picker-${item.id}`}
                                  onClick={() =>
                                    setOpenItemId((id) =>
                                      id === item.id ? null : item.id,
                                    )
                                  }
                                >
                                  詳細
                                </Button>
                              </div>
                              <Show when={openItemId() === item.id}>
                                <ItemPicker
                                  id={`staff-entry-picker-${item.id}`}
                                  item={item}
                                  onAdd={(e) => {
                                    add(e);
                                    setOpenItemId(null);
                                  }}
                                  onCancel={() => setOpenItemId(null)}
                                />
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </Show>
            </section>

            <section class={styles.section}>
              <h2 class={styles.heading}>送信する内容</h2>
              <Show when={error()}>
                <ErrorAlert>{error()}</ErrorAlert>
              </Show>
              {/* Always mounted so the message is announced when it appears. */}
              <p class={styles.success} role="status">
                {success()}
              </p>
              <Show
                when={lines().length > 0}
                fallback={<p class={styles.empty}>まだ追加されていません</p>}
              >
                <ul class={styles.lines}>
                  <Index each={lines()}>
                    {(line) => (
                      <li class={styles.line}>
                        <div class={styles.lineInfo}>
                          <span class={styles.itemName}>{line().name}</span>
                          <Show when={line().option_labels.length > 0}>
                            <span class={styles.lineDetail}>
                              {line().option_labels.join("、")}
                            </span>
                          </Show>
                          <Show when={line().note}>
                            <span class={styles.lineDetail}>{line().note}</span>
                          </Show>
                        </div>
                        <div class={styles.lineControls}>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${line().name}を1つ減らす`}
                            onClick={() =>
                              setLines((prev) =>
                                setDraftQuantity(
                                  prev,
                                  line().key,
                                  line().quantity - 1,
                                ),
                              )
                            }
                          >
                            −
                          </Button>
                          <span class={styles.lineQty}>{line().quantity}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${line().name}を1つ増やす`}
                            disabled={line().quantity >= MAX_LINE_QUANTITY}
                            onClick={() =>
                              setLines((prev) =>
                                setDraftQuantity(
                                  prev,
                                  line().key,
                                  line().quantity + 1,
                                ),
                              )
                            }
                          >
                            ＋
                          </Button>
                          <span class={styles.linePrice}>
                            {formatYen(line().unit_price * line().quantity)}
                          </span>
                        </div>
                      </li>
                    )}
                  </Index>
                </ul>
                <div class={styles.total}>
                  <span>合計</span>
                  <span>{formatYen(draftTotal(lines()))}</span>
                </div>
              </Show>
              <Button
                fullWidth
                disabled={submitting() || !seatId() || lines().length === 0}
                onClick={submit}
              >
                {submitting()
                  ? "送信中..."
                  : seatId()
                    ? `${seatName()}に注文を送信`
                    : "座席を選んでください"}
              </Button>
            </section>
          </>
        )}
      </Show>
    </div>
  );
}
