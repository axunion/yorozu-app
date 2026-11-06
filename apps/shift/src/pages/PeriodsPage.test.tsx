import { fireEvent, render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContext } from "../layouts/ShiftGuard";
import { data, type MockRoute, mockFetch } from "../test-helpers";
import PeriodsPage from "./PeriodsPage";

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
  A: (props: { href: string; children: unknown }) => (
    <a href={props.href}>{props.children as string}</a>
  ),
}));

const store = {
  id: "store-1",
  name: "テスト店舗",
  email: "owner@test.internal",
  role: "owner" as const,
};

const renderPage = () =>
  render(() => (
    <StoreContext.Provider value={store}>
      <PeriodsPage />
    </StoreContext.Provider>
  ));

/** Both date inputs default relative to today, so tests set them explicitly. */
const setDates = async (cover: string, deadline: string) => {
  fireEvent.input(await screen.findByLabelText("期間に含まれる日"), {
    target: { value: cover },
  });
  fireEvent.input(screen.getByLabelText("希望提出の締切"), {
    target: { value: deadline },
  });
};

const postBody = (stub: ReturnType<typeof mockFetch>) => {
  const call = stub.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === "POST",
  ) as [string, RequestInit] | undefined;
  return call ? JSON.parse(String(call[1].body)) : undefined;
};

const createRoutes = (extra: MockRoute[] = []): MockRoute[] => [
  ...extra,
  { url: "/api/shift/periods", method: "POST", json: data({}) },
  { url: "/api/shift/periods", json: data([]) },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PeriodsPage", () => {
  it("starts the form on the next half-month, not the one under way", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 2026-09-20 12:00 JST: inside 9/16–9/30.
    vi.setSystemTime(new Date("2026-09-20T03:00:00Z"));
    vi.stubGlobal("fetch", mockFetch(createRoutes()));

    renderPage();

    expect(
      await screen.findByText("10/1(木)〜10/15(木) の半月分を作成します。"),
    ).toBeTruthy();
  });

  it("derives the first half of a month from a date inside it", async () => {
    const fetchStub = mockFetch(createRoutes());
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await setDates("2026-09-05", "2026-08-25");
    await user.click(screen.getByRole("button", { name: "作成する" }));

    expect(postBody(fetchStub)).toMatchObject({
      start_date: "2026-09-01",
      end_date: "2026-09-15",
    });
  });

  it("derives the second half, ending on the real last day of the month", async () => {
    // February in a leap year is the only case that exercises the
    // last-day-of-month computation rather than a fixed 30 or 31.
    const fetchStub = mockFetch(createRoutes());
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await setDates("2024-02-20", "2024-02-10");
    await user.click(screen.getByRole("button", { name: "作成する" }));

    expect(postBody(fetchStub)).toMatchObject({
      start_date: "2024-02-16",
      end_date: "2024-02-29",
    });
  });

  it("sends the deadline as the end of the chosen JST day", async () => {
    // The end, not the start: a deadline of "the 10th" means the 10th is
    // still usable. The difference is invisible in the UI.
    const fetchStub = mockFetch(createRoutes());
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await setDates("2026-09-20", "2026-09-10");
    await user.click(screen.getByRole("button", { name: "作成する" }));

    const endOfDayJst = Date.UTC(2026, 8, 11) - 9 * 60 * 60 * 1000;
    expect(postBody(fetchStub).submission_deadline).toBe(endOfDayJst);
    expect(postBody(fetchStub).submission_deadline).not.toBe(
      Date.UTC(2026, 8, 10) - 9 * 60 * 60 * 1000,
    );
  });

  it("previews exactly the range it will create", async () => {
    vi.stubGlobal("fetch", mockFetch(createRoutes()));

    renderPage();
    await setDates("2026-09-20", "2026-09-10");

    expect(
      screen.getByText("9/16(水)〜9/30(水) の半月分を作成します。"),
    ).toBeTruthy();
  });

  it("reloads the list after creating, and links each period to its builder", async () => {
    const created = {
      id: "period-9",
      start_date: "2026-09-16",
      end_date: "2026-09-30",
      status: "collecting" as const,
      submission_deadline: 1,
      published_at: null,
    };
    let listCalls = 0;
    const fetchStub = vi
      .fn()
      .mockImplementation((_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "POST") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ data: created }),
          });
        }
        listCalls += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: listCalls === 1 ? [] : [created] }),
        });
      });
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    expect(await screen.findByText("まだ期間がありません。")).toBeTruthy();

    await setDates("2026-09-20", "2026-09-10");
    await user.click(screen.getByRole("button", { name: "作成する" }));

    const link = await screen.findByRole("link", {
      name: /9\/16\(水\)/,
    });
    expect(link.getAttribute("href")).toBe("/periods/period-9");
    expect(screen.getByText("希望受付中")).toBeTruthy();
    expect(listCalls).toBe(2);
  });

  it("shows the API's reason when creation is refused", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/shift/periods",
          method: "POST",
          ok: false,
          status: 409,
          json: {
            error: { code: "CONFLICT", message: "この期間はすでにあります。" },
          },
        },
        { url: "/api/shift/periods", json: data([]) },
      ]),
    );
    const user = userEvent.setup();

    renderPage();
    await setDates("2026-09-20", "2026-09-10");
    await user.click(screen.getByRole("button", { name: "作成する" }));

    expect(await screen.findByText("この期間はすでにあります。")).toBeTruthy();
  });
});
