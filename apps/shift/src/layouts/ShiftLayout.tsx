import { A, useNavigate } from "@solidjs/router";
import { apiFetch } from "@yorozu/core/client";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { useStoreInfo } from "./ShiftGuard";
import styles from "./ShiftLayout.module.css";

/**
 * Page chrome: the store name, a back link when the page has a parent, and
 * logout. Mirrors AdminLayout's shape so the two products feel related.
 */
export default function ShiftLayout(props: {
  title: string;
  backHref?: string;
  backLabel?: string;
  children?: JSX.Element;
}) {
  const store = useStoreInfo();
  const navigate = useNavigate();

  const handleLogout = async () => {
    // ?app=shift brings the logout redirect back to this SPA's login page.
    await apiFetch("/api/auth/logout?app=shift", { method: "POST" });
    navigate("/login", { replace: true });
  };

  return (
    <div class={styles.shell}>
      <header class={styles.header}>
        <div class={styles.headerInner}>
          <Show when={props.backHref}>
            {(href) => (
              <A href={href()} class={styles.back}>
                ← {props.backLabel ?? "戻る"}
              </A>
            )}
          </Show>
          <span class={styles.storeName}>{store.name}</span>
          <button type="button" class={styles.logout} onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      </header>

      <main class={styles.main}>
        <h1 class={styles.title}>{props.title}</h1>
        {props.children}
      </main>
    </div>
  );
}
