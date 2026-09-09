import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContext } from "../layouts/AdminGuard";
import StoreSettings from "./StoreSettings";

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

function renderWithStore(
  store: {
    id: string;
    name: string;
    email: string;
    role: "owner" | "staff";
  } = {
    id: "store-1",
    name: "テスト食堂",
    email: "owner@test.internal",
    role: "owner",
  },
) {
  return render(() => (
    <StoreContext.Provider value={store}>
      <StoreSettings />
    </StoreContext.Provider>
  ));
}

describe("StoreSettings — store name", () => {
  it("pre-fills the name field with the current store name", async () => {
    renderWithStore();
    const input = (await screen.findByLabelText("店舗名")) as HTMLInputElement;
    expect(input.value).toBe("テスト食堂");
  });

  it("shows the current email as read-only text", async () => {
    renderWithStore();
    await screen.findByText("owner@test.internal");
  });

  it("saves the new name via PATCH and shows a confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/stores/me",
        method: "PATCH",
        json: { data: { id: "store-1", name: "新食堂", slug: "test-abcde" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    renderWithStore();
    const input = await screen.findByLabelText("店舗名");
    await user.clear(input);
    await user.type(input, "新食堂");
    const saveBtn = screen.getByRole("button", { name: "保存" });
    await user.click(saveBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stores/me",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"name":"新食堂"'),
      }),
    );
    await screen.findByText("保存しました。");
  });

  it("shows an error when the rename request fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/stores/me",
          method: "PATCH",
          ok: false,
          json: {
            error: { code: "VALIDATION_ERROR", message: "店舗名が不正です。" },
          },
        },
      ]),
    );

    renderWithStore();
    const saveBtn = await screen.findByRole("button", { name: "保存" });
    await user.click(saveBtn);

    await screen.findByText("店舗名が不正です。");
  });
});

describe("StoreSettings — email change", () => {
  it("requests an email change and moves on to the code step", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/stores/me/email-change",
        method: "POST",
        json: { data: { sent: true } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    renderWithStore();
    const input = await screen.findByLabelText("新しいメールアドレス");
    await user.type(input, "new-owner@example.com");
    const submitBtn = screen.getByRole("button", { name: "変更をリクエスト" });
    await user.click(submitBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stores/me/email-change",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"new_email":"new-owner@example.com"'),
      }),
    );
    await screen.findByLabelText("確認コード");
    expect(screen.queryByLabelText("新しいメールアドレス")).toBeNull();
    // The current email is unchanged until the code is confirmed, so it stays
    // visible alongside the code prompt.
    expect(screen.queryByText("owner@test.internal")).not.toBeNull();
  });

  it("confirms the change in place, without issuing a new session", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      // The verify route is listed first because this file's mockFetch matches
      // on url.includes(): "/api/stores/me/email-change" would otherwise
      // swallow the request to its own /verify sub-path.
      mockFetch([
        {
          url: "/api/stores/me/email-change/verify",
          method: "POST",
          json: { data: { email: "new-owner@example.com" } },
        },
        {
          url: "/api/stores/me/email-change",
          method: "POST",
          json: { data: { sent: true } },
        },
      ]),
    );

    renderWithStore();
    await user.type(
      await screen.findByLabelText("新しいメールアドレス"),
      "new-owner@example.com",
    );
    await user.click(screen.getByRole("button", { name: "変更をリクエスト" }));

    await user.type(await screen.findByLabelText("確認コード"), "123456");
    await user.click(screen.getByRole("button", { name: "変更を確定する" }));

    // The caller was already signed in, so the change lands on this screen
    // rather than bouncing them through a fresh session.
    expect(
      await screen.findByText(/new-owner@example\.com に変更しました/),
    ).toBeTruthy();
  });

  it("shows a dev-only code when the API echoes one", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/stores/me/email-change",
          method: "POST",
          json: { data: { sent: true, code: "123456" } },
        },
      ]),
    );

    renderWithStore();
    await user.type(
      await screen.findByLabelText("新しいメールアドレス"),
      "new-owner@example.com",
    );
    await user.click(screen.getByRole("button", { name: "変更をリクエスト" }));

    expect(await screen.findByText(/\[DEV\] 確認コード: 123456/)).toBeTruthy();
  });

  it("shows an error when the email-change request fails (e.g. duplicate)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/stores/me/email-change",
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
    const input = await screen.findByLabelText("新しいメールアドレス");
    await user.type(input, "taken@example.com");
    await user.click(screen.getByRole("button", { name: "変更をリクエスト" }));

    await screen.findByText("このメールアドレスはすでに使用されています。");
    // The form stays visible so the owner can correct and retry.
    expect(screen.queryByLabelText("新しいメールアドレス")).not.toBeNull();
  });
});

describe("StoreSettings — log out everywhere", () => {
  it("calls POST /api/auth/logout-all when clicked", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/auth/logout-all",
        method: "POST",
        json: { data: { sent: true } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    renderWithStore();
    const btn = await screen.findByRole("button", {
      name: "ログアウト（全端末）",
    });
    await user.click(btn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout-all",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("StoreSettings — danger zone", () => {
  it("hides the danger zone for a staff-role session", async () => {
    renderWithStore({
      id: "store-1",
      name: "テスト食堂",
      email: "staff@test.internal",
      role: "staff",
    });
    await screen.findByLabelText("店舗名");
    expect(screen.queryByText("危険な操作")).toBeNull();
  });

  it("shows the danger zone for an owner-role session", async () => {
    renderWithStore();
    await screen.findByText("危険な操作");
  });

  it("calls POST /api/stores/me/suspend when suspend is confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/stores/me/suspend",
        method: "POST",
        json: { data: { id: "store-1", status: "suspended" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    renderWithStore();
    await user.click(screen.getByRole("button", { name: "一時停止する" }));
    await user.click(
      await screen.findByRole("button", { name: "一時停止を確定する" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stores/me/suspend",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps the delete trigger disabled until the typed name matches the store name", async () => {
    const user = userEvent.setup();
    renderWithStore();

    const deleteBtn = screen.getByRole("button", {
      name: "アカウントを削除する",
    });
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText(
      "確認のため店舗名「テスト食堂」を入力してください",
    );
    await user.type(input, "違う名前");
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);

    await user.clear(input);
    await user.type(input, "テスト食堂");
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls DELETE /api/stores/me with confirm_name once confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/stores/me",
        method: "DELETE",
        json: { data: { export: { store: [{ id: "store-1" }] } } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    // happy-dom doesn't implement URL.createObjectURL; add it without
    // replacing the URL constructor itself (a full stubGlobal replacement
    // breaks happy-dom's internal navigation, which uses `new URL(...)`).
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // The download link's click() would otherwise trigger happy-dom's
    // real anchor-navigation handling, which isn't relevant here.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithStore();
    const input = screen.getByLabelText(
      "確認のため店舗名「テスト食堂」を入力してください",
    );
    await user.type(input, "テスト食堂");

    const deleteBtn = screen.getByRole("button", {
      name: "アカウントを削除する",
    });
    await user.click(deleteBtn);
    await user.click(
      await screen.findByRole("button", { name: "完全に削除する" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stores/me",
      expect.objectContaining({
        method: "DELETE",
        body: expect.stringContaining('"confirm_name":"テスト食堂"'),
      }),
    );
  });

  it("shows an error and does not lose the typed confirmation when delete fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/stores/me",
          method: "DELETE",
          ok: false,
          json: {
            error: {
              code: "VALIDATION_ERROR",
              message: "店舗名が一致しません。",
            },
          },
        },
      ]),
    );

    renderWithStore();
    const input = screen.getByLabelText(
      "確認のため店舗名「テスト食堂」を入力してください",
    );
    await user.type(input, "テスト食堂");
    await user.click(
      screen.getByRole("button", { name: "アカウントを削除する" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "完全に削除する" }),
    );

    await screen.findByText("店舗名が一致しません。");
  });
});
