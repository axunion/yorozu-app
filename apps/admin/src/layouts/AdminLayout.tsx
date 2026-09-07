import { A, useNavigate } from "@solidjs/router";
import { apiFetch } from "@yorozu/core/client";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { useStoreInfo } from "./AdminGuard";
import styles from "./AdminLayout.module.css";

type Props = {
  title: string;
  backHref?: string;
  backLabel?: string;
  children: JSX.Element;
};

export default function AdminLayout(props: Props) {
  const store = useStoreInfo();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    navigate("/login");
  };

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
      </header>
      <main class={styles.main}>{props.children}</main>
    </div>
  );
}
