import { useNavigate } from "@solidjs/router";
import { apiFetch } from "@yorozu/core/client";
import {
  createContext,
  createSignal,
  type JSX,
  onMount,
  Show,
  useContext,
} from "solid-js";
import NotEnabled from "../components/NotEnabled";

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

/**
 * Mirrors AdminGuard, with one addition this product needs: a store may be
 * signed in and still not subscribe to shift management. The API answers 403
 * for that, which is a different situation from "not logged in" and gets its
 * own screen rather than a redirect to login the user cannot resolve.
 */
export default function ShiftGuard(props: { children?: JSX.Element }) {
  const navigate = useNavigate();
  const [store, setStore] = createSignal<StoreInfo | null>(null);
  const [enabled, setEnabled] = createSignal(true);

  onMount(async () => {
    const me = await apiFetch<StoreInfo>("/api/auth/me");
    if (!me.ok || !me.data) {
      navigate("/login", { replace: true });
      return;
    }

    // Any shift endpoint would do; periods is the one every screen needs.
    const periods = await apiFetch<unknown[]>("/api/shift/periods");
    if (!periods.ok && periods.status === 403) {
      setEnabled(false);
    }

    setStore(me.data);
  });

  return (
    <Show when={store()}>
      {(info) => (
        <StoreContext.Provider value={info()}>
          <Show when={enabled()} fallback={<NotEnabled />}>
            {props.children}
          </Show>
        </StoreContext.Provider>
      )}
    </Show>
  );
}
