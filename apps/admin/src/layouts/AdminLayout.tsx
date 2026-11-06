import { A, useNavigate } from "@solidjs/router";
import { apiFetch } from "@yorozu/core/client";
import type { JSX } from "solid-js";
import {
  createRoot,
  createSignal,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useStoreInfo } from "./AdminGuard";
import styles from "./AdminLayout.module.css";

export type AdminSummary = {
  /** Orders with at least one item not yet served. */
  unserved_orders: number;
  open_calls: number;
  pending_bills: number;
  today_sales: { total: number; count: number };
};

// Module scope rather than component state: every page mounts its own
// AdminLayout, and a per-mount signal would blank the badges and the
// dashboard tiles for a round-trip on every tab switch. Tagged with the
// store it was fetched for, so another account on this tab never sees it.
const [cached, setCached] = createRoot(() =>
  createSignal<{ storeId: string; counts: AdminSummary } | null>(null),
);

/** The latest nav-badge counts for this store (the dashboard shows them too). */
export function useAdminSummary(): () => AdminSummary | null {
  const store = useStoreInfo();
  return () => {
    const entry = cached();
    return entry?.storeId === store.id ? entry.counts : null;
  };
}

const SUMMARY_POLL_MS = 10_000;

type NavItem = {
  href: string;
  label: string;
  ownerOnly?: boolean;
  /** `prefix` tells two badges on one tab apart at a glance. */
  badge?: (
    s: AdminSummary,
  ) => { count: number; label: string; prefix?: string }[];
};

const NAV: NavItem[] = [
  { href: "/", label: "ホーム" },
  {
    href: "/orders",
    label: "注文",
    badge: (s) => [
      { count: s.unserved_orders, label: "件の未提供の注文" },
      { count: s.open_calls, label: "件の呼び出し", prefix: "呼出" },
    ],
  },
  {
    href: "/checkout",
    label: "会計",
    badge: (s) => [{ count: s.pending_bills, label: "件の会計待ち" }],
  },
  { href: "/sales", label: "売上" },
  { href: "/reports", label: "レポート" },
  { href: "/menu", label: "メニュー", ownerOnly: true },
  { href: "/seats", label: "座席", ownerOnly: true },
  { href: "/staff", label: "スタッフ", ownerOnly: true },
  { href: "/settings", label: "設定" },
];

type Props = {
  title: string;
  /** For a sub-page, the screen it belongs to; top-level pages use the nav. */
  backHref?: string;
  backLabel?: string;
  children: JSX.Element;
};

export default function AdminLayout(props: Props) {
  const store = useStoreInfo();
  const navigate = useNavigate();
  let nav: HTMLElement | undefined;

  // During service staff hop between the board and the register; the counts
  // say where they are needed without a detour through the dashboard.
  const summary = useAdminSummary();
  const loadSummary = async () => {
    // A tab left in the background doesn't need the counts refreshed.
    if (document.visibilityState === "hidden") return;
    const storeId = store.id;
    const result = await apiFetch<AdminSummary>("/api/admin/orders/summary");
    if (result.ok && result.data) setCached({ storeId, counts: result.data });
  };
  onMount(() => {
    // On a phone the tab row scrolls; keep the current screen's tab in view.
    nav
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    loadSummary();
    const timer = setInterval(loadSummary, SUMMARY_POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  const handleLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    navigate("/login");
  };

  const badgesFor = (item: NavItem) => {
    const s = summary();
    return s && item.badge ? item.badge(s).filter((b) => b.count > 0) : [];
  };

  const navItems = () =>
    NAV.filter((item) => !item.ownerOnly || store.role === "owner");

  return (
    <div class={styles.layout}>
      <header class={styles.header}>
        <div class={styles.headerInner}>
          <h1 class={styles.headerTitle}>{store.name}</h1>
          <span class={styles.badge}>{props.title}</span>
          <Show when={props.backHref}>
            {(href) => (
              <A class={styles.navLink} href={href()}>
                {props.backLabel}
              </A>
            )}
          </Show>
          <button type="button" class={styles.logoutBtn} onClick={handleLogout}>
            ログアウト
          </button>
        </div>
        <nav ref={nav} class={styles.nav} aria-label="管理メニュー">
          <ul class={styles.navList}>
            <For each={navItems()}>
              {(item) => (
                <li>
                  <A
                    href={item.href}
                    end={item.href === "/"}
                    class={styles.tab}
                    activeClass={styles.tabActive}
                  >
                    {item.label}
                    <Index each={badgesFor(item)}>
                      {(b) => (
                        <span class={styles.count}>
                          <Show when={b().prefix}>
                            <span aria-hidden="true">{b().prefix} </span>
                          </Show>
                          {b().count}
                          <span class={styles.srOnly}>{b().label}</span>
                        </span>
                      )}
                    </Index>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </header>
      <main class={styles.main}>{props.children}</main>
    </div>
  );
}
