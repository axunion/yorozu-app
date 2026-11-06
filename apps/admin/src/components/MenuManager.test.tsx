import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import MenuManager from "./MenuManager";

const downscaleImageMock = vi.fn();
vi.mock("../lib/downscaleImage", () => ({
  downscaleImage: (file: File) => downscaleImageMock(file),
}));

afterEach(() => {
  vi.restoreAllMocks();
  downscaleImageMock.mockReset();
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
    // Nested routes (e.g. a future ".../:groupId/options") are substrings of
    // their parent's URL, so prefer the longest — most specific — string
    // match rather than array order.
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

describe("MenuManager", () => {
  it("fetches categories and items on mount and renders them", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/menu/categories",
          method: "GET",
          json: {
            data: [{ id: "c1", name: "Drinks", sort_order: 0, store_id: "s1" }],
          },
        },
        {
          url: "/api/menu/items",
          method: "GET",
          json: {
            data: [
              {
                id: "i1",
                name: "Latte",
                price: 500,
                is_available: true,
                category_id: "c1",
                sort_order: 0,
                store_id: "s1",
              },
            ],
          },
        },
      ]),
    );

    const { findByRole } = render(() => <MenuManager />);
    await findByRole("button", { name: /削除.*Drinks/ });
    await findByRole("button", { name: /削除.*Latte/ });
  });

  it("submits POST /api/menu/categories when the category form is submitted", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      { url: "/api/menu/items", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/categories",
        method: "POST",
        json: {
          data: { id: "c2", name: "Food", sort_order: 0, store_id: "s1" },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(() => <MenuManager />);
    await user.type(getByLabelText(/カテゴリ名/), "Food");
    await user.click(getByRole("button", { name: /カテゴリを追加/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/categories",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: expect.stringContaining('"name":"Food"'),
      }),
    );
  });

  it("renames and reorders a category inline via PATCH", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/menu/categories",
        method: "GET",
        json: {
          data: [{ id: "c1", name: "ドリンコ", sort_order: 0, store_id: "s1" }],
        },
      },
      { url: "/api/menu/items", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/categories/c1",
        method: "PATCH",
        json: {
          data: { id: "c1", name: "ドリンク", sort_order: 2, store_id: "s1" },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole, getByRole, getByDisplayValue } = render(() => (
      <MenuManager />
    ));
    await user.click(await findByRole("button", { name: "編集 ドリンコ" }));
    const name = getByDisplayValue("ドリンコ");
    await user.clear(name);
    await user.type(name, "ドリンク");
    const sort = document.getElementById(
      "cat-edit-sort-c1",
    ) as HTMLInputElement;
    await user.clear(sort);
    await user.type(sort, "2");
    await user.click(getByRole("button", { name: "保存" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/categories/c1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "ドリンク", sort_order: 2 }),
      }),
    );
  });

  it("submits POST /api/menu/items when the item form is submitted", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      { url: "/api/menu/items", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "POST",
        json: {
          data: {
            id: "i2",
            name: "Espresso",
            price: 350,
            is_available: true,
            category_id: null,
            sort_order: 0,
            store_id: "s1",
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(() => <MenuManager />);
    await user.type(getByLabelText(/商品名/), "Espresso");
    await user.type(getByLabelText(/価格/), "350");
    await user.click(getByRole("button", { name: /商品を追加/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/items",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"Espresso"'),
      }),
    );
  });

  it("includes description in POST /api/menu/items when filled in", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      { url: "/api/menu/items", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "POST",
        json: {
          data: {
            id: "i2",
            name: "Espresso",
            price: 350,
            is_available: true,
            category_id: null,
            sort_order: 0,
            store_id: "s1",
            description: "Rich and bold",
            image_key: null,
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(() => <MenuManager />);
    await user.type(getByLabelText(/商品名/), "Espresso");
    await user.type(getByLabelText(/価格/), "350");
    await user.type(getByLabelText(/商品説明/), "Rich and bold");
    await user.click(getByRole("button", { name: /商品を追加/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/items",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"description":"Rich and bold"'),
      }),
    );
  });

  it("renders an item's photo and description in the list", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/menu/categories", method: "GET", json: { data: [] } },
        {
          url: "/api/menu/items",
          method: "GET",
          json: {
            data: [
              {
                id: "i4",
                name: "Latte",
                price: 500,
                is_available: true,
                category_id: null,
                sort_order: 0,
                store_id: "s1",
                description: "Smooth and creamy",
                image_key: "menu/s1/i4/abc.jpg",
              },
            ],
          },
        },
      ]),
    );

    const { findByText, findByAltText } = render(() => <MenuManager />);
    await findByText("Smooth and creamy");
    const img = (await findByAltText("")) as HTMLImageElement;
    expect(img.src).toContain("/api/menu/images/menu/s1/i4/abc.jpg");
  });

  it("renders no thumbnail for an item with no image", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/menu/categories", method: "GET", json: { data: [] } },
        {
          url: "/api/menu/items",
          method: "GET",
          json: {
            data: [
              {
                id: "i4b",
                name: "Americano",
                price: 400,
                is_available: true,
                category_id: null,
                sort_order: 0,
                store_id: "s1",
                description: null,
                image_key: null,
              },
            ],
          },
        },
      ]),
    );

    const { findByText, queryByAltText } = render(() => <MenuManager />);
    await findByText("Americano");
    expect(queryByAltText("")).toBeNull();
  });

  it("edits name, price, and description via the inline edit form", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "GET",
        json: {
          data: [
            {
              id: "i5",
              name: "Mocha",
              price: 550,
              is_available: true,
              category_id: null,
              sort_order: 0,
              store_id: "s1",
              description: null,
              image_key: null,
            },
          ],
        },
      },
      {
        url: "/api/menu/items/i5",
        method: "PATCH",
        json: {
          data: {
            id: "i5",
            name: "Mocha改",
            price: 600,
            is_available: true,
            category_id: null,
            sort_order: 0,
            store_id: "s1",
            description: "Chocolatey",
            image_key: null,
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole, findByText, getByLabelText } = render(() => (
      <MenuManager />
    ));
    const editBtn = await findByRole("button", { name: /商品を編集 Mocha/ });
    await user.click(editBtn);

    const nameInput = getByLabelText(/商品名を編集 Mocha/);
    await user.clear(nameInput);
    await user.type(nameInput, "Mocha改");
    const priceInput = getByLabelText(/価格を編集 Mocha/);
    await user.clear(priceInput);
    await user.type(priceInput, "600");
    await user.type(getByLabelText(/商品説明を編集 Mocha/), "Chocolatey");
    await user.click(await findByRole("button", { name: "保存" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/items/i5",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"description":"Chocolatey"'),
      }),
    );
    await findByText("Mocha改");
    await findByText("Chocolatey");
  });

  it("uploads a downscaled image via PUT /api/menu/items/:id/image", async () => {
    const user = userEvent.setup();
    const uploadedBlob = new Blob(["fake"], { type: "image/jpeg" });
    downscaleImageMock.mockResolvedValue(uploadedBlob);
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "GET",
        json: {
          data: [
            {
              id: "i6",
              name: "Cappuccino",
              price: 500,
              is_available: true,
              category_id: null,
              sort_order: 0,
              store_id: "s1",
              description: null,
              image_key: null,
            },
          ],
        },
      },
      {
        url: "/api/menu/items/i6/image",
        method: "PUT",
        json: {
          data: {
            id: "i6",
            name: "Cappuccino",
            price: 500,
            is_available: true,
            category_id: null,
            sort_order: 0,
            store_id: "s1",
            description: null,
            image_key: "menu/s1/i6/new.jpg",
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByLabelText, findByAltText } = render(() => <MenuManager />);
    const fileInput = (await findByLabelText(
      /画像を選択 Cappuccino/,
    )) as HTMLInputElement;
    const file = new File(["raw"], "photo.png", { type: "image/png" });
    await user.upload(fileInput, file);

    expect(downscaleImageMock).toHaveBeenCalledWith(file);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/items/i6/image",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: uploadedBlob,
      }),
    );
    const img = (await findByAltText("")) as HTMLImageElement;
    expect(img.src).toContain("/api/menu/images/menu/s1/i6/new.jpg");
  });

  it("shows an error and no thumbnail when the downscale step fails", async () => {
    const user = userEvent.setup();
    downscaleImageMock.mockRejectedValue(new Error("decode failed"));
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "GET",
        json: {
          data: [
            {
              id: "i6b",
              name: "Flat White",
              price: 500,
              is_available: true,
              category_id: null,
              sort_order: 0,
              store_id: "s1",
              description: null,
              image_key: null,
            },
          ],
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByLabelText, findByRole, queryByAltText } = render(() => (
      <MenuManager />
    ));
    const fileInput = (await findByLabelText(
      /画像を選択 Flat White/,
    )) as HTMLInputElement;
    const file = new File(["raw"], "photo.png", { type: "image/png" });
    await user.upload(fileInput, file);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("画像の処理に失敗しました");
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/image")),
    ).toBe(false);
    expect(queryByAltText("")).toBeNull();
  });

  it("shows an error and keeps the item unchanged when image upload fails server-side", async () => {
    const user = userEvent.setup();
    downscaleImageMock.mockResolvedValue(
      new Blob(["fake"], { type: "image/jpeg" }),
    );
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "GET",
        json: {
          data: [
            {
              id: "i6c",
              name: "Macchiato",
              price: 450,
              is_available: true,
              category_id: null,
              sort_order: 0,
              store_id: "s1",
              description: null,
              image_key: null,
            },
          ],
        },
      },
      {
        url: "/api/menu/items/i6c/image",
        method: "PUT",
        ok: false,
        json: {
          error: { code: "PAYLOAD_TOO_LARGE", message: "画像が大きすぎます" },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByLabelText, findByRole, queryByAltText } = render(() => (
      <MenuManager />
    ));
    const fileInput = (await findByLabelText(
      /画像を選択 Macchiato/,
    )) as HTMLInputElement;
    const file = new File(["raw"], "photo.png", { type: "image/png" });
    await user.upload(fileInput, file);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("画像が大きすぎます");
    expect(queryByAltText("")).toBeNull();
  });

  it("removes an image via DELETE /api/menu/items/:id/image when confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "GET",
        json: {
          data: [
            {
              id: "i7",
              name: "Iced Tea",
              price: 400,
              is_available: true,
              category_id: null,
              sort_order: 0,
              store_id: "s1",
              description: null,
              image_key: "menu/s1/i7/old.jpg",
            },
          ],
        },
      },
      {
        url: "/api/menu/items/i7/image",
        method: "DELETE",
        json: {
          data: {
            id: "i7",
            name: "Iced Tea",
            price: 400,
            is_available: true,
            category_id: null,
            sort_order: 0,
            store_id: "s1",
            description: null,
            image_key: null,
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <MenuManager />);
    const removeBtn = await findByRole("button", {
      name: /画像を削除 Iced Tea/,
    });
    await user.click(removeBtn);
    const confirmBtn = await screen.findByRole("button", { name: "削除する" });
    await user.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/items/i7/image",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.queryByAltText("")).toBeNull();
  });

  it("keeps the image and shows an error when image removal fails", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "GET",
        json: {
          data: [
            {
              id: "i7b",
              name: "Oolong Tea",
              price: 400,
              is_available: true,
              category_id: null,
              sort_order: 0,
              store_id: "s1",
              description: null,
              image_key: "menu/s1/i7b/old.jpg",
            },
          ],
        },
      },
      {
        url: "/api/menu/items/i7b/image",
        method: "DELETE",
        ok: false,
        json: {
          error: { code: "NOT_FOUND", message: "商品が見つかりません" },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole, findByAltText } = render(() => <MenuManager />);
    const removeBtn = await findByRole("button", {
      name: /画像を削除 Oolong Tea/,
    });
    await user.click(removeBtn);
    const confirmBtn = await screen.findByRole("button", { name: "削除する" });
    await user.click(confirmBtn);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("商品が見つかりません");
    expect(await findByAltText("")).toBeTruthy();
  });

  it("sends DELETE to /api/menu/categories/:id when delete is confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/menu/categories",
        method: "GET",
        json: {
          data: [
            { id: "c3", name: "To Delete", sort_order: 0, store_id: "s1" },
          ],
        },
      },
      { url: "/api/menu/items", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/categories/c3",
        method: "DELETE",
        json: { data: { id: "c3" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <MenuManager />);
    const deleteBtn = await screen.findByRole("button", {
      name: /削除.*To Delete|To Delete.*削除/,
    });
    await user.click(deleteBtn);

    const confirmBtn = await screen.findByRole("button", { name: "削除する" });
    await user.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/categories/c3",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends DELETE to /api/menu/items/:id when delete is confirmed", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
      {
        url: "/api/menu/items",
        method: "GET",
        json: {
          data: [
            {
              id: "i3",
              name: "To Delete Item",
              price: 200,
              is_available: true,
              category_id: null,
              sort_order: 0,
              store_id: "s1",
            },
          ],
        },
      },
      {
        url: "/api/menu/items/i3",
        method: "DELETE",
        json: { data: { id: "i3" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <MenuManager />);
    const deleteBtn = await screen.findByRole("button", {
      name: /削除.*To Delete Item|To Delete Item.*削除/,
    });
    await user.click(deleteBtn);

    const confirmBtn = await screen.findByRole("button", { name: "削除する" });
    await user.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/items/i3",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("shows an error message when API call fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/menu/categories", method: "GET", json: { data: [] } },
        { url: "/api/menu/items", method: "GET", json: { data: [] } },
        {
          url: "/api/menu/categories",
          method: "POST",
          ok: false,
          json: {
            error: { code: "VALIDATION_ERROR", message: "name is required" },
          },
        },
      ]),
    );

    const { getByLabelText, getByRole, findByRole } = render(() => (
      <MenuManager />
    ));
    await user.type(getByLabelText(/カテゴリ名/), "X");
    await user.click(getByRole("button", { name: /カテゴリを追加/ }));

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("name is required");
  });
});

describe("MenuManager option group attachment", () => {
  it("renders attached option group names on the item row", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/menu/categories", method: "GET", json: { data: [] } },
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
          url: "/api/menu/items",
          method: "GET",
          json: {
            data: [
              {
                id: "i1",
                name: "Latte",
                price: 500,
                is_available: true,
                category_id: null,
                sort_order: 0,
                store_id: "s1",
                description: null,
                image_key: null,
                option_group_ids: ["g1"],
              },
            ],
          },
        },
      ]),
    );

    const { findByText } = render(() => <MenuManager />);
    await findByText("オプション: Size");
  });

  it("shows a checkbox per option group in the edit form, pre-checked for attached groups", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/menu/categories", method: "GET", json: { data: [] } },
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
              {
                id: "g2",
                store_id: "s1",
                name: "Toppings",
                min_select: 0,
                max_select: 3,
                sort_order: 1,
              },
            ],
          },
        },
        {
          url: "/api/menu/items",
          method: "GET",
          json: {
            data: [
              {
                id: "i2",
                name: "Ramen",
                price: 800,
                is_available: true,
                category_id: null,
                sort_order: 0,
                store_id: "s1",
                description: null,
                image_key: null,
                option_group_ids: ["g1"],
              },
            ],
          },
        },
      ]),
    );

    const { findByRole } = render(() => <MenuManager />);
    const editBtn = await findByRole("button", { name: /商品を編集 Ramen/ });
    await user.click(editBtn);

    const sizeCheckbox = (await findByRole("checkbox", {
      name: "Size",
    })) as HTMLInputElement;
    const toppingsCheckbox = (await findByRole("checkbox", {
      name: "Toppings",
    })) as HTMLInputElement;
    expect(sizeCheckbox.checked).toBe(true);
    expect(toppingsCheckbox.checked).toBe(false);
  });

  it("submits the toggled set of option_group_ids when the edit form is saved", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/menu/categories", method: "GET", json: { data: [] } },
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
            {
              id: "g2",
              store_id: "s1",
              name: "Toppings",
              min_select: 0,
              max_select: 3,
              sort_order: 1,
            },
          ],
        },
      },
      {
        url: "/api/menu/items",
        method: "GET",
        json: {
          data: [
            {
              id: "i3",
              name: "Udon",
              price: 700,
              is_available: true,
              category_id: null,
              sort_order: 0,
              store_id: "s1",
              description: null,
              image_key: null,
              option_group_ids: ["g1"],
            },
          ],
        },
      },
      {
        url: "/api/menu/items/i3",
        method: "PATCH",
        json: {
          data: {
            id: "i3",
            name: "Udon",
            price: 700,
            is_available: true,
            category_id: null,
            sort_order: 0,
            store_id: "s1",
            description: null,
            image_key: null,
            option_group_ids: ["g2"],
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <MenuManager />);
    const editBtn = await findByRole("button", { name: /商品を編集 Udon/ });
    await user.click(editBtn);

    // Uncheck Size (was attached), check Toppings (was not).
    const sizeCheckbox = await findByRole("checkbox", { name: "Size" });
    const toppingsCheckbox = await findByRole("checkbox", {
      name: "Toppings",
    });
    await user.click(sizeCheckbox);
    await user.click(toppingsCheckbox);
    await user.click(await findByRole("button", { name: "保存" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/menu/items/i3",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"option_group_ids":["g2"]'),
      }),
    );
  });
});
