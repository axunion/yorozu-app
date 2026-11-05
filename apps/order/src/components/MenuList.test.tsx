import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MenuList from "./MenuList";
import type { MenuGroup, MenuItem } from "./OrderScreen";

const plainItem: MenuItem = {
  id: "item1",
  category_id: "cat1",
  name: "コーヒー",
  price: 500,
  sort_order: 0,
  description: null,
  image_key: null,
  option_groups: [],
};

const itemWithOptions: MenuItem = {
  id: "item2",
  category_id: "cat1",
  name: "ラーメン",
  price: 800,
  sort_order: 1,
  description: null,
  image_key: null,
  option_groups: [
    {
      id: "g1",
      name: "麺の量",
      min_select: 1,
      max_select: 1,
      sort_order: 0,
      options: [
        { id: "o1", name: "普通", price_delta: 0, sort_order: 0 },
        { id: "o2", name: "大盛り", price_delta: 100, sort_order: 1 },
      ],
    },
  ],
};

function makeGroups(items: MenuItem[]): MenuGroup[] {
  return [{ key: "cat1", categoryName: "メニュー", items }];
}

describe("MenuList", () => {
  it("adds an item without option groups to the cart in one tap", async () => {
    const onAddToCart = vi.fn();
    const user = userEvent.setup();
    const { getByRole, queryByRole } = render(() => (
      <MenuList
        groups={makeGroups([plainItem])}
        locked={false}
        onAddToCart={onAddToCart}
      />
    ));

    expect(queryByRole("button", { name: /オプションを選ぶ$/ })).toBeNull();
    await user.click(getByRole("button", { name: "コーヒーをカートに追加" }));

    expect(onAddToCart).toHaveBeenCalledWith({
      menu_item_id: "item1",
      name: "コーヒー",
      unit_price: 500,
      quantity: 1,
      option_ids: [],
      option_labels: [],
      note: null,
    });
  });

  it("renders an 'オプションを選ぶ' button instead of the one-tap button for an item with option groups", () => {
    const { getByRole, queryByRole } = render(() => (
      <MenuList
        groups={makeGroups([itemWithOptions])}
        locked={false}
        onAddToCart={vi.fn()}
      />
    ));

    expect(getByRole("button", { name: /オプションを選ぶ$/ })).toBeTruthy();
    expect(
      queryByRole("button", { name: "ラーメンをカートに追加" }),
    ).toBeNull();
  });

  it("disables every add control once the order is locked for the bill", () => {
    const { getByRole } = render(() => (
      <MenuList
        groups={makeGroups([plainItem, itemWithOptions])}
        locked={true}
        onAddToCart={vi.fn()}
      />
    ));

    expect(
      (
        getByRole("button", {
          name: "コーヒーをカートに追加",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (getByRole("button", { name: /オプションを選ぶ$/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // Kobalte's Dialog.Portal renders the sheet as a sibling of render()'s own
  // container (appended to document.body), so it must be queried via
  // `screen` rather than render()'s destructured queries. The dialog title
  // is an <h2> ("heading" role), which disambiguates it from the item card's
  // plain-text name below, since both render "ラーメン" once the sheet opens.
  it("adds the selected option to the cart from the detail sheet and closes it", async () => {
    const onAddToCart = vi.fn();
    const user = userEvent.setup();
    const { getByRole } = render(() => (
      <MenuList
        groups={makeGroups([itemWithOptions])}
        locked={false}
        onAddToCart={onAddToCart}
      />
    ));

    await user.click(getByRole("button", { name: /オプションを選ぶ$/ }));
    expect(screen.getByRole("heading", { name: "ラーメン" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /^大盛り/ }));
    await user.click(screen.getByRole("button", { name: /をカートに追加$/ }));

    expect(onAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        menu_item_id: "item2",
        unit_price: 900,
        option_ids: ["o2"],
      }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole("heading", { name: "ラーメン" })).toBeNull();
    });
  });
});
