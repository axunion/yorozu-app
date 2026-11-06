import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import OptionGroupManager from "./OptionGroupManager";

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
    const candidates = routes.filter((r) => {
      const urlMatch =
        typeof r.url === "string" ? url.includes(r.url) : r.url.test(url);
      const methodMatch = !r.method || r.method.toUpperCase() === method;
      return urlMatch && methodMatch;
    });
    // Nested routes (e.g. ".../:groupId/options") are substrings of their
    // parent's URL, so prefer the longest — most specific — string match
    // rather than array order.
    const route = candidates.sort((a, b) => {
      const lenA = typeof a.url === "string" ? a.url.length : 0;
      const lenB = typeof b.url === "string" ? b.url.length : 0;
      return lenB - lenA;
    })[0];
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

describe("OptionGroupManager", () => {
  it("fetches groups and their options on mount and renders them", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/menu/option-groups",
          method: "GET",
          json: {
            data: [
              {
                id: "g1",
                store_id: "s1",
                name: "Size",
                min_select: 1,
                max_select: 1,
                sort_order: 0,
              },
            ],
          },
        },
        {
          url: "/api/menu/option-groups/g1/options",
          method: "GET",
          json: {
            data: [
              {
                id: "o1",
                store_id: "s1",
                group_id: "g1",
                name: "Large",
                price_delta: 100,
                sort_order: 0,
              },
            ],
          },
        },
      ]),
    );

    const { findByText } = render(() => <OptionGroupManager />);
    await findByText("Size");
    await findByText("Large");
    await findByText("+¥100");
  });

  it("submits POST /api/menu/option-groups when the create-group form is submitted", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/option-groups", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/option-groups",
        method: "POST",
        json: {
          data: {
            id: "g2",
            store_id: "s1",
            name: "Toppings",
            min_select: 0,
            max_select: 3,
            sort_order: 0,
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole, findByText } = render(() => (
      <OptionGroupManager />
    ));
    await user.type(getByLabelText(/グループ名/), "Toppings");
    await user.click(getByRole("button", { name: /グループを追加/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/option-groups",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Toppings",
          min_select: 0,
          max_select: 1,
        }),
      }),
    );
    await findByText("Toppings");
  });

  it("submits POST .../options when the add-option form is submitted", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/menu/option-groups",
        method: "GET",
        json: {
          data: [
            {
              id: "g1",
              store_id: "s1",
              name: "Size",
              min_select: 1,
              max_select: 1,
              sort_order: 0,
            },
          ],
        },
      },
      {
        url: "/api/menu/option-groups/g1/options",
        method: "GET",
        json: { data: [] },
      },
      {
        url: "/api/menu/option-groups/g1/options",
        method: "POST",
        json: {
          data: {
            id: "o1",
            store_id: "s1",
            group_id: "g1",
            name: "Large",
            price_delta: 150,
            sort_order: 0,
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByLabelText, findByText } = render(() => (
      <OptionGroupManager />
    ));
    await findByText("Size");
    const nameInput = await findByLabelText("オプション名 Size");
    const priceInput = await findByLabelText("価格差 Size");
    await user.type(nameInput, "Large");
    await user.type(priceInput, "150");
    await user.click(screen.getByRole("button", { name: /オプションを追加/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/option-groups/g1/options",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Large", price_delta: 150 }),
      }),
    );
    await findByText("Large");
  });

  it("sends DELETE to /api/menu/option-groups/:id when delete is confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/menu/option-groups",
        method: "GET",
        json: {
          data: [
            {
              id: "g3",
              store_id: "s1",
              name: "To Delete",
              min_select: 0,
              max_select: 1,
              sort_order: 0,
            },
          ],
        },
      },
      {
        url: "/api/menu/option-groups/g3/options",
        method: "GET",
        json: { data: [] },
      },
      {
        url: "/api/menu/option-groups/g3",
        method: "DELETE",
        json: { data: { id: "g3" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OptionGroupManager />);
    const deleteBtn = await screen.findByRole("button", {
      name: /グループを削除 To Delete/,
    });
    await user.click(deleteBtn);
    const confirmBtn = await screen.findByRole("button", { name: "削除する" });
    await user.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/option-groups/g3",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.queryByText("To Delete")).toBeNull();
  });

  it("submits PATCH when the group edit form is saved", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/menu/option-groups",
        method: "GET",
        json: {
          data: [
            {
              id: "g4",
              store_id: "s1",
              name: "Size",
              min_select: 0,
              max_select: 1,
              sort_order: 0,
            },
          ],
        },
      },
      {
        url: "/api/menu/option-groups/g4/options",
        method: "GET",
        json: { data: [] },
      },
      {
        url: "/api/menu/option-groups/g4",
        method: "PATCH",
        json: {
          data: {
            id: "g4",
            store_id: "s1",
            name: "Size (Updated)",
            min_select: 1,
            max_select: 1,
            sort_order: 0,
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole, findByLabelText, findByText } = render(() => (
      <OptionGroupManager />
    ));
    const editBtn = await findByRole("button", { name: "グループを編集 Size" });
    await user.click(editBtn);

    const nameInput = await findByLabelText("グループ名を編集 Size");
    await user.clear(nameInput);
    await user.type(nameInput, "Size (Updated)");
    const minInput = await findByLabelText("最小選択数を編集 Size");
    await user.clear(minInput);
    await user.type(minInput, "1");
    await user.click(await findByRole("button", { name: "保存" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/option-groups/g4",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "Size (Updated)",
          min_select: 1,
          max_select: 1,
        }),
      }),
    );
    await findByText("Size (Updated)");
  });

  it("submits PATCH when the option edit form is saved", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/menu/option-groups",
        method: "GET",
        json: {
          data: [
            {
              id: "g5",
              store_id: "s1",
              name: "Size",
              min_select: 0,
              max_select: 1,
              sort_order: 0,
            },
          ],
        },
      },
      {
        url: "/api/menu/option-groups/g5/options",
        method: "GET",
        json: {
          data: [
            {
              id: "o5",
              store_id: "s1",
              group_id: "g5",
              name: "Large",
              price_delta: 100,
              sort_order: 0,
            },
          ],
        },
      },
      {
        url: "/api/menu/option-groups/g5/options/o5",
        method: "PATCH",
        json: {
          data: {
            id: "o5",
            store_id: "s1",
            group_id: "g5",
            name: "Extra Large",
            price_delta: 200,
            sort_order: 0,
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole, findByLabelText, findByText } = render(() => (
      <OptionGroupManager />
    ));
    const editBtn = await findByRole("button", {
      name: "オプションを編集 Size / Large",
    });
    await user.click(editBtn);

    const nameInput = await findByLabelText("オプション名を編集 Large");
    await user.clear(nameInput);
    await user.type(nameInput, "Extra Large");
    const priceInput = await findByLabelText("価格差を編集 Large");
    await user.clear(priceInput);
    await user.type(priceInput, "200");
    await user.click(await findByRole("button", { name: "保存" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/option-groups/g5/options/o5",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Extra Large", price_delta: 200 }),
      }),
    );
    await findByText("Extra Large");
  });

  it("sends DELETE to .../options/:id when option delete is confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/menu/option-groups",
        method: "GET",
        json: {
          data: [
            {
              id: "g6",
              store_id: "s1",
              name: "Size",
              min_select: 0,
              max_select: 1,
              sort_order: 0,
            },
          ],
        },
      },
      {
        url: "/api/menu/option-groups/g6/options",
        method: "GET",
        json: {
          data: [
            {
              id: "o6",
              store_id: "s1",
              group_id: "g6",
              name: "To Delete Option",
              price_delta: 100,
              sort_order: 0,
            },
          ],
        },
      },
      {
        url: "/api/menu/option-groups/g6/options/o6",
        method: "DELETE",
        json: { data: { id: "o6" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OptionGroupManager />);
    const deleteBtn = await screen.findByRole("button", {
      name: "オプションを削除 Size / To Delete Option",
    });
    await user.click(deleteBtn);
    const confirmBtn = await screen.findByRole("button", { name: "削除する" });
    await user.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/option-groups/g6/options/o6",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.queryByText("To Delete Option")).toBeNull();
  });

  it("shows an error message when group creation fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/menu/option-groups", method: "GET", json: { data: [] } },
        {
          url: "/api/menu/option-groups",
          method: "POST",
          ok: false,
          json: {
            error: {
              code: "VALIDATION_ERROR",
              message: "最小選択数は最大選択数以下にしてください。",
            },
          },
        },
      ]),
    );

    const { getByLabelText, getByRole, findByRole } = render(() => (
      <OptionGroupManager />
    ));
    await user.type(getByLabelText(/グループ名/), "Broken");
    await user.click(getByRole("button", { name: /グループを追加/ }));

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain(
      "最小選択数は最大選択数以下にしてください。",
    );
  });
});
