import { apiFetch } from "@yorozu/core/client";
import { Button, ErrorAlert } from "@yorozu/ui";
import QRCode from "qrcode";
import { createSignal, For, onMount, Show } from "solid-js";
import { useStoreInfo } from "../layouts/AdminGuard";
import { orderUrl } from "../lib/orderUrl";
import styles from "./SeatPrintSheet.module.css";

type Seat = { id: string; name: string; qr_token: string };
type Card = { id: string; name: string; qr: string };

/**
 * Every active seat's QR code with the seat and store name, laid out as
 * cut-out table cards — several per A4 page — for the browser's print
 * dialog. Only the cards print; the toolbar and admin chrome are hidden.
 */
export default function SeatPrintSheet() {
  const store = useStoreInfo();
  const [cards, setCards] = createSignal<Card[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");

  onMount(async () => {
    const result = await apiFetch<Seat[]>("/api/seats");
    if (!result.ok || !result.data) {
      setError(result.message ?? "座席の取得に失敗しました。");
      setLoading(false);
      return;
    }
    try {
      setCards(
        await Promise.all(
          result.data.map(async (seat) => ({
            id: seat.id,
            name: seat.name,
            // Larger than the on-screen QR so it stays sharp on paper.
            qr: await QRCode.toDataURL(orderUrl(seat.qr_token), {
              width: 480,
              margin: 1,
            }),
          })),
        ),
      );
    } catch {
      setError("QR コードの生成に失敗しました。");
    }
    setLoading(false);
  });

  return (
    <div class={styles.sheet}>
      <div class={styles.toolbar}>
        <p class={styles.hint}>
          A4 に {cards().length}{" "}
          枚分を印刷します。切り取ってテーブルに置いてください。
        </p>
        <Button
          disabled={loading() || cards().length === 0}
          onClick={() => window.print()}
        >
          印刷する
        </Button>
      </div>
      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>
      <Show when={!loading() && !error() && cards().length === 0}>
        <p class={styles.hint}>印刷できる座席がありません。</p>
      </Show>
      <ul class={styles.cards}>
        <For each={cards()}>
          {(card) => (
            <li class={styles.card}>
              <span class={styles.storeName}>{store.name}</span>
              <img class={styles.qr} src={card.qr} alt={`QR ${card.name}`} />
              <span class={styles.seatName}>{card.name}</span>
              <span class={styles.caption}>
                スマートフォンで読み取ってご注文ください
              </span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
