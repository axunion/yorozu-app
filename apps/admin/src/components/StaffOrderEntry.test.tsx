import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StaffOrderEntry from "./StaffOrderEntry";

afterEach(() => {
  vi.restoreAllMocks();
});

const entryData = {
  data: {
    seats: [
      { id: "seat-1", name: "テーブル1" },
      { id: "seat-2", name: "カウンター" },
    ],
    menu: {
      categories: [{ id: "cat-1", name: "フード", sort_order: 0 }],
      items: [
        {
          id: "item-1",
          category_id: "cat-1",
          name: "唐揚げ",
          price: 500,
          option_groups: [],
        },
        {
          id: "item-2",
          category_id: null,
          name: "ラーメン",
          price: 800,
          option_groups: [
            {
              id: "g-1",
              name: "麺の量",
              min_select: 1,
              max_select: 1,
              options: [
                { id: "o-1", name: "普通", price_delta: 0 },
                { id: "o-2", name: "大盛り", price_delta: 100 },
              ],
            },
          ],
        },
      ],
    },
  },
};

function mockFetch(postOk = true) {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") {
      return Promise.resolve({
        ok: postOk,
        json: async () =>
          postOk
            ? { data: { order: { id: "o" } } }
            : {
                error: {
                  code: "CONFLICT",
                  message: "会計要求中のため新たな注文を追加できません。",
                },
              },
      });
    }
    return Promise.resolve({ ok: true, json: async () => entryData });
  });
}

async function chooseSeat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^座席 / }));
  await user.click(await screen.findByRole("option", { name: "テーブル1" }));
}

describe("StaffOrderEntry", () => {
  it("sends the picked lines, with options and a note, to the chosen seat", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(() => <StaffOrderEntry />);

    await user.click(
      await screen.findByRole("button", { name: "唐揚げを追加" }),
    );
    await user.click(screen.getByRole("button", { name: "唐揚げを追加" }));
    await user.click(screen.getByRole("button", { name: "ラーメンの詳細" }));
    await user.click(screen.getByRole("radio", { name: /大盛り/ }));
    await user.type(screen.getByLabelText("メモ（任意）"), "固め");
    await user.click(screen.getByRole("button", { name: "ラーメンを追加" }));
    expect(screen.getByText("¥1,900")).toBeTruthy();

    await chooseSeat(user);
    await user.click(
      screen.getByRole("button", { name: "テーブル1に注文を送信" }),
    );

    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(post?.[0]).toContain("/api/admin/orders/seats/seat-1/items");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      items: [
        { menu_item_id: "item-1", quantity: 2, option_ids: [], note: null },
        {
          menu_item_id: "item-2",
          quantity: 1,
          option_ids: ["o-2"],
          note: "固め",
        },
      ],
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "テーブル1に注文を送信しました。",
    );
    expect(screen.getByText("まだ追加されていません")).toBeTruthy();
  });

  it("keeps a required option group's add button disabled until it is chosen", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const user = userEvent.setup();
    render(() => <StaffOrderEntry />);

    await user.click(
      await screen.findByRole("button", { name: "ラーメンの詳細" }),
    );
    const add = screen.getByRole("button", {
      name: "ラーメンを追加",
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await user.click(screen.getByRole("radio", { name: /普通/ }));
    expect(add.disabled).toBe(false);
  });

  it("cannot send before a seat is chosen, and keeps the lines when the API refuses", async () => {
    vi.stubGlobal("fetch", mockFetch(false));
    const user = userEvent.setup();
    render(() => <StaffOrderEntry />);

    await user.click(
      await screen.findByRole("button", { name: "唐揚げを追加" }),
    );
    const send = screen.getByRole("button", {
      name: "座席を選んでください",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    await chooseSeat(user);
    await user.click(
      screen.getByRole("button", { name: "テーブル1に注文を送信" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "会計要求中",
    );
    expect(
      screen.getByRole("button", { name: "唐揚げを1つ増やす" }),
    ).toBeTruthy();
  });
});
