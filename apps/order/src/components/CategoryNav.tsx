import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import styles from "./CategoryNav.module.css";
import type { MenuGroup } from "./OrderScreen";
import { categoryElementId } from "./OrderScreen";

export default function CategoryNav(props: { groups: MenuGroup[] }) {
  const [activeKey, setActiveKey] = createSignal<string | null>(null);
  // The nav sits directly under the sticky header, so any page scroll puts
  // content beneath it — that is when the shadow should appear.
  const [scrolled, setScrolled] = createSignal(false);

  onMount(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    onCleanup(() => window.removeEventListener("scroll", update));
  });

  function handleSelect(key: string) {
    setActiveKey(key);
    document
      .getElementById(categoryElementId(key))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <Show when={props.groups.length > 0}>
      <nav
        class={scrolled() ? `${styles.nav} ${styles.navScrolled}` : styles.nav}
        aria-label="カテゴリー"
      >
        <For each={props.groups}>
          {(group) => (
            <button
              type="button"
              class={
                activeKey() === group.key
                  ? `${styles.chip} ${styles.chipActive}`
                  : styles.chip
              }
              aria-current={activeKey() === group.key ? "true" : undefined}
              onClick={() => handleSelect(group.key)}
            >
              {group.categoryName}
            </button>
          )}
        </For>
      </nav>
    </Show>
  );
}
