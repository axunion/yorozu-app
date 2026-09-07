import { apiFetch, jsonFetch } from "@yorozu/core/client";
import { Button, ConfirmDialog, ErrorAlert } from "@yorozu/ui";
import QRCode from "qrcode";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import styles from "./SeatManager.module.css";
import StatusBadge from "./StatusBadge";

type Seat = {
  id: string;
  store_id: string;
  name: string;
  qr_token: string;
  is_active: boolean;
  created_at: number;
};

async function generateQrDataUrl(qrToken: string): Promise<string> {
  const orderBase =
    (import.meta as { env?: Record<string, string> }).env?.VITE_ORDER_BASE ??
    "";
  const url = `${orderBase}/${qrToken}`;
  return QRCode.toDataURL(url, { width: 160, margin: 1 });
}

export default function SeatManager() {
  const [seats, setSeats] = createSignal<Seat[]>([]);
  const [qrUrls, setQrUrls] = createSignal<Record<string, string>>({});
  const [error, setError] = createSignal("");
  const [seatName, setSeatName] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [showRetired, setShowRetired] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editName, setEditName] = createSignal("");
  const [renaming, setRenaming] = createSignal(false);

  const activeSeats = createMemo(() => seats().filter((s) => s.is_active));
  const retiredSeats = createMemo(() => seats().filter((s) => !s.is_active));

  async function loadSeats() {
    const result = await apiFetch<Seat[]>("/api/seats?include_inactive=true");
    if (result.ok && result.data) {
      setSeats(result.data);
      const settled = await Promise.allSettled(
        result.data
          .filter((seat) => seat.is_active)
          .map(async (seat) => ({
            id: seat.id,
            url: await generateQrDataUrl(seat.qr_token),
          })),
      );
      const urls: Record<string, string> = {};
      let hasQrError = false;
      for (const r of settled) {
        if (r.status === "fulfilled") {
          urls[r.value.id] = r.value.url;
        } else {
          hasQrError = true;
        }
      }
      setQrUrls(urls);
      if (hasQrError) setError("一部の QR コードを生成できませんでした。");
    } else {
      setError(result.message ?? "座席の取得に失敗しました");
    }
  }

  onMount(async () => {
    await loadSeats();
  });

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await jsonFetch<Seat>("/api/seats", "POST", {
        name: seatName(),
      });
      if (!result.ok || !result.data) {
        setError(result.message ?? "エラーが発生しました");
        return;
      }
      const newSeat = result.data;
      setSeatName("");
      setSeats((prev) => [...prev, newSeat]);
      try {
        const qrUrl = await generateQrDataUrl(newSeat.qr_token);
        setQrUrls((prev) => ({ ...prev, [newSeat.id]: qrUrl }));
      } catch {
        setError("QR コードの生成に失敗しました。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (seat: Seat) => {
    setEditingId(seat.id);
    setEditName(seat.name);
    setError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleRenameSubmit = async (e: SubmitEvent, seatId: string) => {
    e.preventDefault();
    setError("");
    setRenaming(true);
    try {
      const result = await jsonFetch<Seat>(`/api/seats/${seatId}`, "PATCH", {
        name: editName(),
      });
      if (!result.ok || !result.data) {
        setError(result.message ?? "座席名の変更に失敗しました。");
        return;
      }
      const updated = result.data;
      setSeats((prev) => prev.map((s) => (s.id === seatId ? updated : s)));
      setEditingId(null);
    } finally {
      setRenaming(false);
    }
  };

  const handleRetire = async (id: string) => {
    setError("");
    const result = await apiFetch(`/api/seats/${id}`, { method: "DELETE" });
    if (!result.ok) {
      setError(result.message ?? "座席の無効化に失敗しました");
      return;
    }
    setSeats((prev) =>
      prev.map((s) => (s.id === id ? { ...s, is_active: false } : s)),
    );
    setQrUrls((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleRotateQr = async (seat: Seat) => {
    setError("");
    const result = await apiFetch<Seat>(`/api/seats/${seat.id}/rotate-qr`, {
      method: "POST",
    });
    if (!result.ok || !result.data) {
      setError(result.message ?? "QR コードの再発行に失敗しました。");
      return;
    }
    const updated = result.data;
    setSeats((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    try {
      const qrUrl = await generateQrDataUrl(updated.qr_token);
      setQrUrls((prev) => ({ ...prev, [updated.id]: qrUrl }));
    } catch {
      setError("QR コードの生成に失敗しました。");
    }
  };

  const handleCopyUrl = async (qrToken: string) => {
    const orderBase =
      (import.meta as { env?: Record<string, string> }).env?.VITE_ORDER_BASE ??
      "";
    const url = `${orderBase}/${qrToken}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setError("URLのコピーに失敗しました。手動でコピーしてください。");
    }
  };

  return (
    <div class={styles.seatManager}>
      <Show when={error()}>
        <ErrorAlert>{error()}</ErrorAlert>
      </Show>

      <section class={styles.seatSection}>
        <h2>座席を追加</h2>
        <form onSubmit={handleSubmit} class={styles.seatForm}>
          <div class={styles.field}>
            <label for="seat-name">座席名</label>
            <input
              id="seat-name"
              type="text"
              value={seatName()}
              onInput={(e) => setSeatName(e.currentTarget.value)}
              placeholder="例：テーブル1"
              required
              maxLength={100}
              disabled={submitting()}
            />
          </div>
          <Button type="submit" disabled={submitting()}>
            {submitting() ? "追加中..." : "座席を追加"}
          </Button>
        </form>
      </section>

      <section class={styles.seatSection}>
        <h2>座席一覧</h2>
        <Show
          when={activeSeats().length > 0}
          fallback={<p class={styles.empty}>座席がまだありません</p>}
        >
          <ul class={styles.seatList}>
            <For each={activeSeats()}>
              {(seat) => {
                const orderBase =
                  (import.meta as { env?: Record<string, string> }).env
                    ?.VITE_ORDER_BASE ?? "";
                const orderUrl = () => `${orderBase}/${seat.qr_token}`;
                return (
                  <li class={styles.seatListItem}>
                    <div class={styles.seatInfo}>
                      <Show
                        when={editingId() === seat.id}
                        fallback={
                          <div class={styles.seatNameRow}>
                            <span class={styles.itemName}>{seat.name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`座席名を編集 ${seat.name}`}
                              onClick={() => startEdit(seat)}
                            >
                              編集
                            </Button>
                          </div>
                        }
                      >
                        <form
                          class={styles.renameForm}
                          onSubmit={(e) => handleRenameSubmit(e, seat.id)}
                        >
                          <input
                            type="text"
                            value={editName()}
                            onInput={(e) => setEditName(e.currentTarget.value)}
                            required
                            maxLength={100}
                            disabled={renaming()}
                            aria-label={`座席名を編集 ${seat.name}`}
                          />
                          <Button type="submit" size="sm" disabled={renaming()}>
                            {renaming() ? "保存中..." : "保存"}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={renaming()}
                            onClick={cancelEdit}
                          >
                            キャンセル
                          </Button>
                        </form>
                      </Show>
                      <a
                        class={styles.seatUrl}
                        href={orderUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {orderUrl()}
                      </a>
                    </div>
                    <Show when={qrUrls()[seat.id]}>
                      <div class={styles.seatQr}>
                        <img
                          src={qrUrls()[seat.id]}
                          alt={`QR ${seat.name}`}
                          width={160}
                          height={160}
                        />
                      </div>
                    </Show>
                    <div class={styles.seatActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCopyUrl(seat.qr_token)}
                      >
                        URLをコピー
                      </Button>
                      <ConfirmDialog
                        triggerLabel="QR再発行"
                        triggerVariant="secondary"
                        triggerSize="sm"
                        aria-label={`QRコードを再発行 ${seat.name}`}
                        title="QRコードの再発行"
                        description={`「${seat.name}」のQRコードを再発行しますか？印刷済みの旧QRコードはすぐに使えなくなります。`}
                        confirmLabel="再発行する"
                        onConfirm={() => handleRotateQr(seat)}
                      />
                      <ConfirmDialog
                        triggerLabel="無効化"
                        aria-label={`無効化 ${seat.name}`}
                        title="座席の無効化"
                        description={`「${seat.name}」を無効化しますか？QRコードから注文できなくなります。この操作は元に戻せません。`}
                        confirmLabel="無効化する"
                        onConfirm={() => handleRetire(seat.id)}
                      />
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>

      <section class={styles.seatSection}>
        <label class={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={showRetired()}
            onChange={(e) => setShowRetired(e.currentTarget.checked)}
          />
          無効化した座席を表示
        </label>
        <Show when={showRetired()}>
          <Show
            when={retiredSeats().length > 0}
            fallback={<p class={styles.empty}>無効化した座席はありません</p>}
          >
            <ul class={styles.seatList}>
              <For each={retiredSeats()}>
                {(seat) => (
                  <li class={styles.seatListItem}>
                    <div class={styles.seatInfo}>
                      <div class={styles.seatNameRow}>
                        <span class={styles.itemName}>{seat.name}</span>
                        <StatusBadge tone="danger">無効</StatusBadge>
                      </div>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </section>
    </div>
  );
}
