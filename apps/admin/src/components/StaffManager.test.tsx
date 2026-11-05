import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContext } from "../layouts/AdminGuard";
import StaffManager from "./StaffManager";

afterEach(() => {
  vi.restoreAllMocks();
});

type MockRoute = {
  url: string | RegExp;
  method?: string;
  ok?: boolean;
  json: unknown;
};

function mockFetch(routes: MockRoute[]) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find((r) => {
      const urlMatch =
        typeof r.url === "string" ? url.includes(r.url) : r.url.test(url);
      const methodMatch = !r.method || r.method.toUpperCase() === method;
      return urlMatch && methodMatch;
    });
    if (!route) {
      return Promise.resolve({
        ok: false,
        json: async () => ({
          error: { code: "NOT_FOUND", message: "no route" },
        }),
      });
    }
    const ok = route.ok !== false;
    return Promise.resolve({ ok, json: async () => route.json });
  });
}

const OWNER_STORE = {
  id: "store-1",
  name: "テスト食堂",
  email: "owner@test.internal",
  display_name: null,
  role: "owner" as const,
};

function renderWithStore(store = OWNER_STORE) {
  return render(() => (
    <StoreContext.Provider value={store}>
      <StaffManager />
    </StoreContext.Provider>
  ));
}

describe("StaffManager — list", () => {
  it("fetches members on mount and renders them", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/staff",
          method: "GET",
          json: {
            data: [
              {
                id: "m1",
                email: "owner@test.internal",
                role: "owner",
                status: "active",
                created_at: 1000,
                activated_at: 1000,
              },
            ],
          },
        },
      ]),
    );

    renderWithStore();
    await screen.findByText("owner@test.internal");
  });

  it("shows the empty state when there are no members", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ url: "/api/staff", method: "GET", json: { data: [] } }]),
    );

    renderWithStore();
    await screen.findByText(/メンバーがいません/);
  });

  it("shows an error message when the list fetch fails (e.g. staff-role 403)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/staff",
          method: "GET",
          ok: false,
          json: {
            error: { code: "FORBIDDEN", message: "Owner access required" },
          },
        },
      ]),
    );

    renderWithStore();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Owner access required");
  });
});

describe("StaffManager — invite", () => {
  it("submits POST /api/staff with email and role, then appends the new member", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/staff", method: "GET", json: { data: [] } },
      {
        url: "/api/staff",
        method: "POST",
        json: {
          data: {
            id: "m2",
            email: "new-staff@test.internal",
            role: "staff",
            status: "pending",
            created_at: 2000,
            activated_at: null,
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    renderWithStore();
    await screen.findByText(/メンバーがいません/);
    const emailInput = screen.getByLabelText("メールアドレス");
    await user.type(emailInput, "new-staff@test.internal");
    await user.click(screen.getByRole("button", { name: "招待する" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"email":"new-staff@test.internal"'),
      }),
    );
    await screen.findByText("new-staff@test.internal");
  });

  it("shows an error when the invite request fails (e.g. duplicate email)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/staff", method: "GET", json: { data: [] } },
        {
          url: "/api/staff",
          method: "POST",
          ok: false,
          json: {
            error: {
              code: "VALIDATION_ERROR",
              message: "このメールアドレスはすでに使用されています。",
            },
          },
        },
      ]),
    );

    renderWithStore();
    await screen.findByText(/メンバーがいません/);
    await user.type(
      screen.getByLabelText("メールアドレス"),
      "taken@test.internal",
    );
    await user.click(screen.getByRole("button", { name: "招待する" }));

    await screen.findByText("このメールアドレスはすでに使用されています。");
  });
});

describe("StaffManager — remove", () => {
  it("sends DELETE to /api/staff/:id when removal is confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/staff",
        method: "GET",
        json: {
          data: [
            {
              id: "m1",
              email: "owner@test.internal",
              role: "owner",
              status: "active",
              created_at: 1000,
              activated_at: 1000,
            },
            {
              id: "m3",
              email: "removable@test.internal",
              role: "staff",
              status: "active",
              created_at: 1500,
              activated_at: 1500,
            },
          ],
        },
      },
      {
        url: "/api/staff/m3",
        method: "DELETE",
        json: { data: { id: "m3" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    renderWithStore();
    await screen.findByText("removable@test.internal");
    const removeBtn = screen.getByRole("button", {
      name: "削除 removable@test.internal",
    });
    await user.click(removeBtn);
    await user.click(await screen.findByRole("button", { name: "削除する" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/m3",
      expect.objectContaining({ method: "DELETE" }),
    );
    await screen.findByText("owner@test.internal");
    expect(screen.queryByText("removable@test.internal")).toBeNull();
  });

  it("disables the remove button for the caller's own row", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/staff",
          method: "GET",
          json: {
            data: [
              {
                id: "m1",
                email: "owner@test.internal",
                role: "owner",
                status: "active",
                created_at: 1000,
                activated_at: 1000,
              },
              {
                id: "m4",
                email: "co-owner@test.internal",
                role: "owner",
                status: "active",
                created_at: 1200,
                activated_at: 1200,
              },
            ],
          },
        },
      ]),
    );

    renderWithStore();
    await screen.findByText("co-owner@test.internal");

    const selfRemoveBtn = screen.getByRole("button", {
      name: "削除 owner@test.internal",
    });
    expect((selfRemoveBtn as HTMLButtonElement).disabled).toBe(true);

    // A co-owner exists, so removing them is not the last-owner case.
    const coOwnerRemoveBtn = screen.getByRole("button", {
      name: "削除 co-owner@test.internal",
    });
    expect((coOwnerRemoveBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the remove button for the sole remaining owner", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/staff",
          method: "GET",
          json: {
            data: [
              {
                id: "m5",
                email: "sole-owner@test.internal",
                role: "owner",
                status: "active",
                created_at: 1000,
                activated_at: 1000,
              },
              {
                id: "m6",
                email: "staff-member@test.internal",
                role: "staff",
                status: "active",
                created_at: 1100,
                activated_at: 1100,
              },
            ],
          },
        },
      ]),
    );

    renderWithStore({ ...OWNER_STORE, email: "someone-else@test.internal" });
    await screen.findByText("sole-owner@test.internal");

    const soleOwnerRemoveBtn = screen.getByRole("button", {
      name: "削除 sole-owner@test.internal",
    });
    expect((soleOwnerRemoveBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("StaffManager — display name", () => {
  const member = {
    id: "m3",
    email: "hanako@test.internal",
    display_name: null,
    role: "staff",
    status: "active",
    created_at: 1000,
    activated_at: 1000,
  };

  it("sends an optional name with the invite", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/staff", method: "GET", json: { data: [] } },
      {
        url: "/api/staff",
        method: "POST",
        json: { data: { ...member, display_name: "山田 花子" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    renderWithStore();
    await screen.findByText(/メンバーがいません/);
    await user.type(
      screen.getByLabelText("メールアドレス"),
      "hanako@test.internal",
    );
    await user.type(screen.getByLabelText("表示名（任意）"), "山田 花子");
    await user.click(screen.getByRole("button", { name: "招待する" }));

    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body)).display_name).toBe("山田 花子");
    expect(await screen.findByText("山田 花子")).toBeTruthy();
  });

  it("renames a member inline via PATCH", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/staff", method: "GET", json: { data: [member] } },
      {
        url: "/api/staff/m3",
        method: "PATCH",
        json: { data: { id: "m3", display_name: "花子" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    renderWithStore();
    await user.click(
      await screen.findByRole("button", {
        name: "表示名を編集 hanako@test.internal",
      }),
    );
    await user.type(screen.getByLabelText("表示名"), "花子");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/staff/m3"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ display_name: "花子" }),
      }),
    );
    expect(await screen.findByText("花子")).toBeTruthy();
    expect(screen.queryByLabelText("表示名")).toBeNull();
    // Focus returns to the member's edit button instead of dropping to body.
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "表示名を編集 hanako@test.internal",
      ),
    );
  });
});
