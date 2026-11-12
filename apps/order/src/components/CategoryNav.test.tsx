import { render } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CategoryNav from "./CategoryNav";
import type { Category, MenuItem } from "./OrderScreen";
import { groupMenuItems } from "./OrderScreen";

describe("CategoryNav", () => {
  it("renders one chip per category that has items", () => {
    const categories: Category[] = [
      { id: "cat1", name: "ドリンク", sort_order: 0 },
      { id: "cat2", name: "フード", sort_order: 1 },
    ];
    const items: MenuItem[] = [
      {
        id: "item1",
        category_id: "cat1",
        name: "コーヒー",
        price: 500,
        sort_order: 0,
        description: null,
        image_key: null,
        option_groups: [],
      },
      {
        id: "item2",
        category_id: "cat2",
        name: "サンドイッチ",
        price: 700,
        sort_order: 0,
        description: null,
        image_key: null,
        option_groups: [],
      },
    ];

    const { getByRole, queryByRole } = render(() => (
      <CategoryNav groups={groupMenuItems(categories, items)} />
    ));

    expect(getByRole("button", { name: "ドリンク" })).toBeTruthy();
    expect(getByRole("button", { name: "フード" })).toBeTruthy();
    expect(queryByRole("button", { name: "その他" })).toBeNull();
  });

  it("renders a その他 chip only when uncategorized items exist", () => {
    const categories: Category[] = [
      { id: "cat3", name: "前菜", sort_order: 0 },
    ];
    const items: MenuItem[] = [
      {
        id: "item3",
        category_id: "cat3",
        name: "サラダ",
        price: 400,
        sort_order: 0,
        description: null,
        image_key: null,
        option_groups: [],
      },
      {
        id: "item4",
        category_id: null,
        name: "おまけ",
        price: 100,
        sort_order: 1,
        description: null,
        image_key: null,
        option_groups: [],
      },
    ];

    const { getByRole } = render(() => (
      <CategoryNav groups={groupMenuItems(categories, items)} />
    ));

    expect(getByRole("button", { name: "その他" })).toBeTruthy();
  });

  it("scrolls to the matching section when a chip is clicked", async () => {
    const categories: Category[] = [
      { id: "cat5", name: "麺類", sort_order: 0 },
    ];
    const items: MenuItem[] = [
      {
        id: "item5",
        category_id: "cat5",
        name: "ラーメン",
        price: 800,
        sort_order: 0,
        description: null,
        image_key: null,
        option_groups: [],
      },
    ];
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const section = document.createElement("div");
    section.id = "menu-category-cat5";
    document.body.appendChild(section);

    const user = userEvent.setup();
    const { getByRole } = render(() => (
      <CategoryNav groups={groupMenuItems(categories, items)} />
    ));

    await user.click(getByRole("button", { name: "麺類" }));

    expect(scrollSpy).toHaveBeenCalled();
    section.remove();
  });

  it("marks only the clicked chip as active via aria-current", async () => {
    const categories: Category[] = [
      { id: "cat6", name: "丼物", sort_order: 0 },
      { id: "cat7", name: "お寿司", sort_order: 1 },
    ];
    const items: MenuItem[] = [
      {
        id: "item6",
        category_id: "cat6",
        name: "牛丼",
        price: 600,
        sort_order: 0,
        description: null,
        image_key: null,
        option_groups: [],
      },
      {
        id: "item7",
        category_id: "cat7",
        name: "握り",
        price: 900,
        sort_order: 0,
        description: null,
        image_key: null,
        option_groups: [],
      },
    ];

    const user = userEvent.setup();
    const { getByRole } = render(() => (
      <CategoryNav groups={groupMenuItems(categories, items)} />
    ));

    const donburiChip = getByRole("button", { name: "丼物" });
    const sushiChip = getByRole("button", { name: "お寿司" });

    expect(donburiChip.getAttribute("aria-current")).toBeNull();
    await user.click(donburiChip);

    expect(donburiChip.getAttribute("aria-current")).toBe("true");
    expect(sushiChip.getAttribute("aria-current")).toBeNull();
  });

  describe("scroll shadow", () => {
    const groups = groupMenuItems(
      [{ id: "cat1", name: "ドリンク", sort_order: 0 }],
      [
        {
          id: "item1",
          category_id: "cat1",
          name: "コーヒー",
          price: 500,
          sort_order: 0,
          description: null,
          image_key: null,
          option_groups: [],
        },
      ],
    );

    afterEach(() => {
      Object.defineProperty(window, "scrollY", {
        value: 0,
        configurable: true,
      });
    });

    function scrollTo(y: number) {
      Object.defineProperty(window, "scrollY", {
        value: y,
        configurable: true,
      });
      window.dispatchEvent(new Event("scroll"));
    }

    it("has no shadow until content scrolls beneath it", () => {
      scrollTo(0);
      const { getByRole } = render(() => <CategoryNav groups={groups} />);
      const nav = getByRole("navigation", { name: "カテゴリー" });
      expect(nav.className).not.toContain("navScrolled");

      scrollTo(40);
      expect(nav.className).toContain("navScrolled");

      scrollTo(0);
      expect(nav.className).not.toContain("navScrolled");
    });
  });
});
