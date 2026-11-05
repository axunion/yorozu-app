import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContext } from "../layouts/ShiftGuard";
import { data, type MockRoute, mockFetch } from "../test-helpers";
import BuilderPage from "./BuilderPage";

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ periodId: "period-1" }),
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

// 2026-09-01 is a Tuesday (weekday 2) and 09-02 a Wednesday (weekday 3).
const period = {
  id: "period-1",
  start_date: "2026-09-01",
  end_date: "2026-09-02",
  status: "building" as const,
  submission_deadline: 1,
  published_at: null,
};

const members = [
  {
    id: "member-1",
    email: "hall@test.internal",
    role: "staff" as const,
    position_ids: ["pos-1"],
    hourly_wage: 1000,
    weekly_cap_minutes: null,
    is_minor: false,
  },
  {
    id: "member-2",
    email: "kitchen@test.internal",
    role: "staff" as const,
    position_ids: [],
    hourly_wage: null,
    weekly_cap_minutes: null,
    is_minor: false,
  },
];

const positions = [
  { id: "pos-1", name: "ホール", sort_order: 0, is_active: true },
];

const patterns = [
  {
    id: "pattern-1",
    name: "早番",
    start_minutes: 540,
    end_minutes: 1020,
    sort_order: 0,
    is_active: true,
  },
];

const requirements = [
  // Tuesday wants two people; Wednesday wants one.
  {
    id: "req-1",
    weekday: 2,
    position_id: "pos-1",
    start_minutes: 540,
    end_minutes: 1020,
    required_headcount: 2,
  },
  {
    id: "req-2",
    weekday: 3,
    position_id: "pos-1",
    start_minutes: 540,
    end_minutes: 1020,
    required_headcount: 1,
  },
  // Tuesday evening: exactly one person needed and exactly one working.
  {
    id: "req-3",
    weekday: 2,
    position_id: "pos-1",
    start_minutes: 1080,
    end_minutes: 1140,
    required_headcount: 1,
  },
];

const shifts = [
  // 10 hours with no break: over the daily limit, and one short on Tuesday.
  {
    id: "shift-1",
    period_id: "period-1",
    member_id: "member-1",
    position_id: "pos-1",
    work_date: "2026-09-01",
    start_minutes: 540,
    end_minutes: 1140,
    break_minutes: 0,
    note: null,
  },
  // Two people on a Wednesday that only wants one.
  {
    id: "shift-2",
    period_id: "period-1",
    member_id: "member-1",
    position_id: "pos-1",
    work_date: "2026-09-02",
    start_minutes: 540,
    end_minutes: 1020,
    break_minutes: 60,
    note: null,
  },
  {
    id: "shift-3",
    period_id: "period-1",
    member_id: "member-2",
    position_id: "pos-1",
    work_date: "2026-09-02",
    start_minutes: 540,
    end_minutes: 1020,
    break_minutes: 60,
    note: null,
  },
];

const scheduleRoute = (overrides: Record<string, unknown> = {}): MockRoute => ({
  url: "/api/shift/schedule/period-1",
  json: data({
    period,
    published: false,
    shifts,
    submissions: [
      {
        id: "sub-1",
        member_id: "member-1",
        status: "submitted",
        submitted_at: 1,
        note: null,
        entries: [],
      },
      {
        id: "sub-2",
        member_id: "member-2",
        status: "draft",
        submitted_at: null,
        note: null,
        entries: [],
      },
    ],
    requirements,
    ...overrides,
  }),
});

const routes = (extra: MockRoute[] = []): MockRoute[] => [
  ...extra,
  scheduleRoute(),
  { url: "/api/shift/members", json: data(members) },
  { url: "/api/shift/positions", json: data(positions) },
  { url: "/api/shift/templates/patterns", json: data(patterns) },
];

/** How many times the schedule was fetched — one on mount, one per reload. */
const scheduleReads = (stub: ReturnType<typeof mockFetch>) =>
  stub.mock.calls.filter((c) =>
    String(c[0]).endsWith("/api/shift/schedule/period-1"),
  ).length;

const renderPage = () =>
  render(() => (
    <StoreContext.Provider value={store}>
      <BuilderPage />
    </StoreContext.Provider>
  ));

afterEach(() => vi.restoreAllMocks());

describe("BuilderPage", () => {
  it("marks a band short of its requirement and one over it", async () => {
    vi.stubGlobal("fetch", mockFetch(routes()));

    renderPage();

    // Tuesday: one assigned against two required.
    const short = await screen.findByText(/1\/2/);
    expect(short.textContent).toContain("不足");
    // Wednesday: two assigned against one required.
    const over = screen.getByText(/2\/1/);
    expect(over.textContent).toContain("過剰");
    // The two states must also be visually distinct, not only worded so:
    // the row carries the shortage or surplus token class, never the same one.
    expect(short.closest("li")?.className).toMatch(/shortage/);
    expect(over.closest("li")?.className).toMatch(/surplus/);

    // An exactly-staffed band is neither, and says nothing extra.
    const met = screen.getByText(/1\/1/);
    expect(met.textContent).not.toContain("不足");
    expect(met.textContent).not.toContain("過剰");
    expect(met.closest("li")?.className).not.toMatch(/shortage|surplus/);
  });

  it("lists a daily-over-8h warning without blocking publication", async () => {
    vi.stubGlobal("fetch", mockFetch(routes()));

    renderPage();

    expect(await screen.findByText("1日8時間を超えています")).toBeTruthy();
    const publish = await screen.findByRole("button", { name: "公開する" });
    expect((publish as HTMLButtonElement).disabled).toBe(false);
  });

  it("names the members with no submitted submission", async () => {
    vi.stubGlobal("fetch", mockFetch(routes()));

    renderPage();

    // member-2 has a *draft* submission, which is not a submitted one.
    const line = await screen.findByText(/^未提出：/);
    expect(line.textContent).toContain("kitchen@test.internal");
    expect(line.textContent).not.toContain("hall@test.internal");
  });

  it("shows each member's submitted wish on the day card, available members first", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        scheduleRoute({
          shifts: [],
          submissions: [
            {
              id: "sub-1",
              member_id: "member-1",
              status: "submitted",
              submitted_at: 1,
              note: null,
              entries: [
                {
                  id: "e-1",
                  work_date: "2026-09-01",
                  kind: "day_off",
                  start_minutes: null,
                  end_minutes: null,
                },
              ],
            },
            {
              id: "sub-2",
              member_id: "member-2",
              status: "submitted",
              submitted_at: 1,
              note: null,
              entries: [
                {
                  id: "e-2",
                  work_date: "2026-09-01",
                  kind: "available",
                  start_minutes: 600,
                  end_minutes: 900,
                },
              ],
            },
          ],
        }),
        ...routes().slice(1),
      ]),
    );

    renderPage();

    const wishes = await screen.findByRole("list", { name: "9/1(火)の希望" });
    expect(
      [...wishes.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual([
      "kitchen@test.internal勤務可 10:00–15:00",
      "hall@test.internal休み希望",
    ]);
    const select = screen.getByLabelText("9/1(火)に追加するスタッフ");
    expect(
      [...select.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual([
      "スタッフを選ぶ",
      "kitchen@test.internal（勤務可 10:00–15:00）",
      "hall@test.internal（休み希望）",
    ]);
  });

  it("warns about a shift on a requested day off", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        scheduleRoute({
          submissions: [
            {
              id: "sub-1",
              member_id: "member-1",
              status: "submitted",
              submitted_at: 1,
              note: null,
              entries: [
                {
                  id: "e-1",
                  work_date: "2026-09-02",
                  kind: "day_off",
                  start_minutes: null,
                  end_minutes: null,
                },
              ],
            },
          ],
        }),
        ...routes().slice(1),
      ]),
    );

    renderPage();

    expect(await screen.findByText("休み希望の日に入っています")).toBeTruthy();
  });

  it("totals only the members whose wage is recorded, and says who is left out", async () => {
    vi.stubGlobal("fetch", mockFetch(routes()));

    renderPage();

    // member-1: 600 + 420 worked minutes at ¥1000/h = ¥17,000. The total
    // equals that one member because member-2's shift carries no wage —
    // both the grand total and the per-member row show it.
    expect(await screen.findAllByText("¥17,000")).toHaveLength(2);
    // Excluded, not rated at zero: member-2 gets no row of their own.
    expect(screen.queryByText("¥0")).toBeNull();
    expect((await screen.findByText(/時給が未登録/)).textContent).toContain(
      "kitchen@test.internal",
    );
  });

  it("adds a shift from a pattern button and reloads the schedule", async () => {
    const fetchStub = mockFetch(
      routes([{ url: "/api/shift/shifts", method: "POST", json: data({}) }]),
    );
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole("heading", { name: "9/1(火)" });

    const [memberSelect] = screen.getAllByLabelText(
      "9/1(火)に追加するスタッフ",
    );
    await user.selectOptions(memberSelect as HTMLSelectElement, "member-2");
    await user.click(
      screen.getAllByRole("button", { name: /早番/ })[0] as Element,
    );

    const call = fetchStub.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    ) as [string, RequestInit];
    expect(String(call[0])).toContain("/api/shift/shifts");
    expect(JSON.parse(String(call[1].body))).toEqual({
      period_id: "period-1",
      work_date: "2026-09-01",
      member_id: "member-2",
      position_id: null,
      start_minutes: 540,
      end_minutes: 1020,
      break_minutes: 0,
    });
    // A write that skips the reload leaves the grid showing stale rows.
    expect(scheduleReads(fetchStub)).toBe(2);
  });

  it("shows the API's reason when a shift clashes with one already there", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        routes([
          {
            url: "/api/shift/shifts",
            method: "POST",
            ok: false,
            status: 409,
            json: {
              error: {
                code: "CONFLICT",
                message:
                  "このスタッフはこの時間帯にすでにシフトが入っています。",
              },
            },
          },
        ]),
      ),
    );
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole("heading", { name: "9/1(火)" });

    await user.selectOptions(
      screen.getAllByLabelText(
        "9/1(火)に追加するスタッフ",
      )[0] as HTMLSelectElement,
      "member-1",
    );
    await user.click(
      screen.getByRole("button", { name: "9/1(火)に早番で追加" }),
    );

    expect(
      await screen.findByText(
        "このスタッフはこの時間帯にすでにシフトが入っています。",
      ),
    ).toBeTruthy();
  });

  it("deletes a shift only after the confirmation is accepted", async () => {
    const fetchStub = mockFetch(
      routes([
        { url: "/api/shift/shifts/shift-1", method: "DELETE", json: data({}) },
      ]),
    );
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole("heading", { name: "9/1(火)" });

    await user.click(
      screen.getByRole("button", {
        name: "9/1(火)のhall@test.internalのシフトを削除",
      }),
    );
    // Opening the dialog is not the delete.
    expect(
      fetchStub.mock.calls.some(
        (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
      ),
    ).toBe(false);

    await user.click(await screen.findByRole("button", { name: "削除する" }));

    const call = fetchStub.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
    ) as [string, RequestInit];
    expect(String(call[0])).toContain("/api/shift/shifts/shift-1");
    expect(scheduleReads(fetchStub)).toBe(2);
  });

  it("publishes the period and says so", async () => {
    const fetchStub = mockFetch(
      routes([
        {
          url: "/api/shift/periods/period-1/publish",
          method: "POST",
          json: data({}),
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await user.click(await screen.findByRole("button", { name: "公開する" }));

    const call = fetchStub.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    ) as [string, RequestInit];
    expect(String(call[0])).toContain("/api/shift/periods/period-1/publish");
    expect(await screen.findByText(/公開しました/)).toBeTruthy();
    expect(scheduleReads(fetchStub)).toBe(2);
  });

  it("closes submissions from a collecting period", async () => {
    const fetchStub = mockFetch([
      {
        url: "/api/shift/periods/period-1/close-submissions",
        method: "POST",
        json: data({}),
      },
      scheduleRoute({ period: { ...period, status: "collecting" } }),
      { url: "/api/shift/members", json: data(members) },
      { url: "/api/shift/positions", json: data(positions) },
      { url: "/api/shift/templates/patterns", json: data(patterns) },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await user.click(
      await screen.findByRole("button", { name: "希望を締め切る" }),
    );

    const call = fetchStub.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    ) as [string, RequestInit];
    expect(String(call[0])).toContain(
      "/api/shift/periods/period-1/close-submissions",
    );
    expect(await screen.findByText(/締め切りました/)).toBeTruthy();
  });

  it("exports the schedule as CSV with worked minutes per row", async () => {
    // member-1 has a display name, member-2 falls back to the email.
    vi.stubGlobal(
      "fetch",
      mockFetch(
        routes([
          {
            url: "/api/shift/members",
            json: data([
              { ...members[0], display_name: "山田" },
              { ...members[1], display_name: null },
            ]),
          },
        ]),
      ),
    );
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    // happy-dom would navigate on the download link's click; capture the
    // link instead, so the filename it carries can be asserted.
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    const user = userEvent.setup();

    renderPage();
    await screen.findByRole("heading", { name: "9/1(火)" });
    await user.click(screen.getByRole("button", { name: "CSV出力" }));

    const rows = (await (blobs[0] as Blob).text()).split("\r\n");
    expect(rows[0]).toContain(
      "日付,スタッフ,メールアドレス,ポジション,開始,終了,休憩(分),実働(分)",
    );
    // Every shift in the period and nothing else: header plus three rows.
    expect(rows).toHaveLength(4);
    expect(rows[1]).toBe(
      "2026-09-01,山田,hall@test.internal,ホール,09:00,19:00,0,600",
    );
    // The break is subtracted here too, so this row is not a copy of the first.
    expect(rows[3]).toBe(
      "2026-09-02,kitchen@test.internal,kitchen@test.internal,ホール,09:00,17:00,60,420",
    );
    expect(downloadName).toBe("shifts-2026-09-01_2026-09-02.csv");
  });

  it("offers closing submissions instead of publishing while still collecting", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        scheduleRoute({ period: { ...period, status: "collecting" } }),
        { url: "/api/shift/members", json: data(members) },
        { url: "/api/shift/positions", json: data(positions) },
        { url: "/api/shift/templates/patterns", json: data(patterns) },
      ]),
    );

    renderPage();

    expect(
      await screen.findByRole("button", { name: "希望を締め切る" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "公開する" })).toBeNull();
  });
});
