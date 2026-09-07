import { useNavigate } from "@solidjs/router";
import { apiFetch } from "@yorozu/core/client";
import type { JSX } from "solid-js";
import {
  createContext,
  createSignal,
  onMount,
  Show,
  useContext,
} from "solid-js";

export type StoreInfo = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
};

export const StoreContext = createContext<StoreInfo>({
  id: "",
  name: "",
  email: "",
  role: "staff",
});

export const useStoreInfo = () => useContext(StoreContext);

export default function AdminGuard(props: { children?: JSX.Element }) {
  const navigate = useNavigate();
  const [store, setStore] = createSignal<StoreInfo | null>(null);

  onMount(async () => {
    const result = await apiFetch<StoreInfo>("/api/auth/me");
    if (!result.ok || !result.data) {
      navigate("/login", { replace: true });
      return;
    }
    setStore(result.data);
  });

  return (
    <Show when={store()}>
      {(s) => (
        <StoreContext.Provider value={s()}>
          {props.children}
        </StoreContext.Provider>
      )}
    </Show>
  );
}
