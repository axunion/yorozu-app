import { fireEvent, render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContext } from "../layouts/ShiftGuard";
import { data, mockFetch } from "../test-helpers";
import AvailabilityPage from "./AvailabilityPage";

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
  email: "staff@test.internal",
  role: "staff" as const,
};

// A two-day period keeps the rendered list small enough to assert on.
const period = {
  id: "period-1",
  start_date: "2026-09-01",
  end_date: "2026-09-02",
  status: "collecting" as const,
  submission_deadline: 1,
  published_at: null,
};

const submission = (entries: unknown[]) =>
  data({
    id: "submission-1",
    member_id: "member-1",
    status: "draft",
    submitted_at: null,
    note: null,
    entries,
  });

const renderPage = () =>
  render(() => (
    <StoreContext.Provider value={store}>
      <AvailabilityPage />
    </StoreContext.Provider>
  ));

afterEach(() => vi.restoreAllMocks());

describe("AvailabilityPage", () => {
  it("renders one row per day of the period", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/shift/periods/period-1", json: data(period) },
        { url: "/api/shift/availability/period-1/me", json: submission([]) },
      ]),
    );

    renderPage();

    expect(await screen.findByText("9/1(火)")).toBeTruthy();
    expect(screen.getByText("9/2(水)")).toBeTruthy();
    // Exactly two rows: one choice group per day, no duplicates.
    expect(screen.getAllByRole("button", { name: "休み" })).toHaveLength(2);
  });

  it("prefills from the saved submission", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/shift/periods/period-1", json: data(period) },
        {
          url: "/api/shift/availability/period-1/me",
          json: submission([
            {
              id: "entry-1",
              work_date: "2026-09-01",
              kind: "available",
              start_minutes: 600,
              end_minutes: 1140,
            },
            {
              id: "entry-2",
              work_date: "2026-09-02",
              kind: "day_off",
              start_minutes: null,
              end_minutes: null,
            },
          ]),
        },
      ]),
    );

    renderPage();

    const startTime = await screen.findByLabelText("9/1(火)の開始時刻");
    expect((startTime as HTMLInputElement).value).toBe("10:00");
    expect(
      (screen.getByLabelText("9/1(火)の終了時刻") as HTMLInputElement).value,
    ).toBe("19:00");

    // The day-off row is the pressed choice, and carries no time inputs.
    const dayOffButtons = screen.getAllByRole("button", { name: "休み" });
    expect(dayOffButtons[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByLabelText("9/2(水)の開始時刻")).toBeNull();
  });

  it("sends submit: false for a draft and true for a submission", async () => {
    const fetchStub = mockFetch([
      { url: "/api/shift/periods/period-1", json: data(period) },
      { url: "/api/shift/availability/period-1/me", json: submission([]) },
      {
        url: "/api/shift/availability/period-1/me",
        method: "PUT",
        json: submission([]),
      },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("9/1(火)");

    // Mark the first day as a day off so the request carries an entry.
    await user.click(
      screen.getAllByRole("button", { name: "休み" })[0] as Element,
    );
    await user.click(screen.getByRole("button", { name: "下書き保存" }));

    const draftCall = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(String(draftCall[0])).toContain(
      "/api/shift/availability/period-1/me",
    );
    expect(draftCall[1].method).toBe("PUT");
    const draftBody = JSON.parse(String(draftCall[1].body));
    expect(draftBody.submit).toBe(false);
    expect(draftBody.entries).toEqual([
      { work_date: "2026-09-01", kind: "day_off" },
    ]);
    expect(await screen.findByText("下書きを保存しました。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "提出する" }));
    const submitCall = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(submitCall[1].body)).submit).toBe(true);
  });

  it("will not submit with every day left 未定, but still saves a draft", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/shift/periods/period-1", json: data(period) },
        { url: "/api/shift/availability/period-1/me", json: submission([]) },
      ]),
    );
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("9/1(火)");

    const submit = () =>
      screen.getByRole("button", { name: "提出する" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "下書き保存" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    await user.click(
      screen.getAllByRole("button", { name: "休み" })[0] as Element,
    );
    expect(submit().disabled).toBe(false);
  });

  it("sends the chosen band for an available day", async () => {
    const fetchStub = mockFetch([
      { url: "/api/shift/periods/period-1", json: data(period) },
      { url: "/api/shift/availability/period-1/me", json: submission([]) },
      {
        url: "/api/shift/availability/period-1/me",
        method: "PUT",
        json: submission([]),
      },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("9/1(火)");

    await user.click(
      screen.getAllByRole("button", { name: "勤務可" })[0] as Element,
    );
    await user.click(screen.getByRole("button", { name: "提出する" }));

    const call = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(String(call[0])).toContain("/api/shift/availability/period-1/me");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(String(call[1].body)).entries).toEqual([
      {
        work_date: "2026-09-01",
        kind: "available",
        start_minutes: 540,
        end_minutes: 1020,
      },
    ]);
  });

  it("sends the times the member actually typed, not the defaults", async () => {
    const fetchStub = mockFetch([
      { url: "/api/shift/periods/period-1", json: data(period) },
      { url: "/api/shift/availability/period-1/me", json: submission([]) },
      {
        url: "/api/shift/availability/period-1/me",
        method: "PUT",
        json: submission([]),
      },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("9/1(火)");
    await user.click(
      screen.getAllByRole("button", { name: "勤務可" })[0] as Element,
    );

    fireEvent.input(screen.getByLabelText("9/1(火)の開始時刻"), {
      target: { value: "10:30" },
    });
    fireEvent.input(screen.getByLabelText("9/1(火)の終了時刻"), {
      target: { value: "19:45" },
    });
    await user.click(screen.getByRole("button", { name: "提出する" }));

    const call = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(call[1].body)).entries).toEqual([
      {
        work_date: "2026-09-01",
        kind: "available",
        start_minutes: 630,
        end_minutes: 1185,
      },
    ]);
  });

  it("keeps focus in the time input while it is being edited", async () => {
    // Replacing the whole day object would make <For> rebuild the row, which
    // drops focus mid-entry — the reason the rows live in a store.
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/shift/periods/period-1", json: data(period) },
        { url: "/api/shift/availability/period-1/me", json: submission([]) },
      ]),
    );
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("9/1(火)");
    await user.click(
      screen.getAllByRole("button", { name: "勤務可" })[0] as Element,
    );

    const start = screen.getByLabelText("9/1(火)の開始時刻");
    start.focus();
    fireEvent.input(start, { target: { value: "10:30" } });

    // The edit landed *and* the row survived it: without the value check
    // this would pass hardest when onInput is missing entirely.
    expect((start as HTMLInputElement).value).toBe("10:30");
    expect(screen.getByLabelText("9/1(火)の開始時刻")).toBe(start);
    expect(document.activeElement).toBe(start);
  });

  it("re-submits an overnight band unchanged instead of wrapping it past midnight", async () => {
    // 25:00 has no <input type="time"> representation; rendering it there
    // would read back as 01:00 and the resubmit would be rejected by the API.
    const fetchStub = mockFetch([
      { url: "/api/shift/periods/period-1", json: data(period) },
      {
        url: "/api/shift/availability/period-1/me",
        json: submission([
          {
            id: "entry-1",
            work_date: "2026-09-01",
            kind: "available",
            start_minutes: 1260,
            end_minutes: 1500,
          },
        ]),
      },
      {
        url: "/api/shift/availability/period-1/me",
        method: "PUT",
        json: submission([]),
      },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByText("21:00–25:00")).toBeTruthy();
    expect(screen.queryByLabelText("9/1(火)の開始時刻")).toBeNull();

    await user.click(screen.getByRole("button", { name: "提出する" }));

    const call = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(call[1].body)).entries).toEqual([
      {
        work_date: "2026-09-01",
        kind: "available",
        start_minutes: 1260,
        end_minutes: 1500,
      },
    ]);
  });

  it("blocks saving while a day does not end after it starts, and unblocks on a fix", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/shift/periods/period-1", json: data(period) },
        { url: "/api/shift/availability/period-1/me", json: submission([]) },
      ]),
    );
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("9/1(火)");
    await user.click(
      screen.getAllByRole("button", { name: "勤務可" })[0] as Element,
    );

    const end = screen.getByLabelText("9/1(火)の終了時刻");
    const submit = () =>
      screen.getByRole("button", { name: "提出する" }) as HTMLButtonElement;

    // The boundary: an end equal to the start is zero minutes, not a shift.
    fireEvent.input(end, { target: { value: "09:00" } });
    expect(screen.getByText("終了は開始より後にしてください")).toBeTruthy();
    expect(submit().disabled).toBe(true);

    fireEvent.input(end, { target: { value: "08:00" } });
    expect(submit().disabled).toBe(true);

    // Correcting it clears the block, so the message cannot be a constant.
    fireEvent.input(end, { target: { value: "18:00" } });
    expect(screen.queryByText("終了は開始より後にしてください")).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it("lets an overnight band be re-entered as an ordinary one", async () => {
    const fetchStub = mockFetch([
      { url: "/api/shift/periods/period-1", json: data(period) },
      {
        url: "/api/shift/availability/period-1/me",
        json: submission([
          {
            id: "entry-1",
            work_date: "2026-09-01",
            kind: "available",
            start_minutes: 1260,
            end_minutes: 1500,
          },
        ]),
      },
      {
        url: "/api/shift/availability/period-1/me",
        method: "PUT",
        json: submission([]),
      },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("21:00–25:00");

    // The button is the only way out of the read-only overnight display.
    await user.click(screen.getByRole("button", { name: "入力し直す" }));
    expect(screen.getByLabelText("9/1(火)の開始時刻")).toBeTruthy();
    expect(screen.queryByText("21:00–25:00")).toBeNull();

    await user.click(screen.getByRole("button", { name: "提出する" }));
    const call = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(call[1].body)).entries).toEqual([
      {
        work_date: "2026-09-01",
        kind: "available",
        start_minutes: 540,
        end_minutes: 1020,
      },
    ]);
  });

  it("shows only the first band of a day the API returned twice", async () => {
    // The schema allows several bands per (submission, work_date); this form
    // deliberately offers one, and a re-save drops the rest. Nothing in v1
    // writes a second band, so this pins the limitation rather than hides it.
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/shift/periods/period-1", json: data(period) },
        {
          url: "/api/shift/availability/period-1/me",
          json: submission([
            {
              id: "entry-1",
              work_date: "2026-09-01",
              kind: "available",
              start_minutes: 600,
              end_minutes: 780,
            },
            {
              id: "entry-2",
              work_date: "2026-09-01",
              kind: "available",
              start_minutes: 1080,
              end_minutes: 1320,
            },
          ]),
        },
      ]),
    );

    renderPage();

    const start = await screen.findByLabelText("9/1(火)の開始時刻");
    expect((start as HTMLInputElement).value).toBe("10:00");
    // One band, not two: the second entry for 9/1 has no row of its own.
    expect(screen.getAllByLabelText(/の開始時刻$/)).toHaveLength(1);
  });

  it("copies the previous period onto matching weekdays without saving", async () => {
    const fetchStub = mockFetch([
      { url: "/api/shift/periods/period-1", json: data(period) },
      {
        url: "/api/shift/periods",
        json: data([
          period,
          {
            ...period,
            id: "period-0",
            start_date: "2026-08-16",
            end_date: "2026-08-31",
          },
        ]),
      },
      { url: "/api/shift/availability/period-1/me", json: submission([]) },
      {
        url: "/api/shift/availability/period-0/me",
        json: submission([
          // 2026-08-25 is a Tuesday, like 2026-09-01; 08-26 a Wednesday.
          {
            id: "old-1",
            work_date: "2026-08-25",
            kind: "available",
            start_minutes: 660,
            end_minutes: 1200,
          },
          {
            id: "old-2",
            work_date: "2026-08-26",
            kind: "day_off",
            start_minutes: null,
            end_minutes: null,
          },
        ]),
      },
      {
        url: "/api/shift/availability/period-1/me",
        method: "PUT",
        json: submission([]),
      },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("9/1(火)");
    await user.click(
      screen.getByRole("button", { name: "前の期間からコピー" }),
    );

    expect(
      ((await screen.findByLabelText("9/1(火)の開始時刻")) as HTMLInputElement)
        .value,
    ).toBe("11:00");
    expect(
      screen
        .getAllByRole("button", { name: "休み" })[1]
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    // Copying prefills the form only — the member still has to save.
    expect(
      fetchStub.mock.calls.some(
        (call) => (call[1] as RequestInit | undefined)?.method === "PUT",
      ),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: "提出する" }));
    const call = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(call[1].body)).entries).toEqual([
      {
        work_date: "2026-09-01",
        kind: "available",
        start_minutes: 660,
        end_minutes: 1200,
      },
      { work_date: "2026-09-02", kind: "day_off" },
    ]);
  });

  it("offers no copy button when there is no earlier period", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/shift/periods/period-1", json: data(period) },
        { url: "/api/shift/periods", json: data([period]) },
        { url: "/api/shift/availability/period-1/me", json: submission([]) },
      ]),
    );

    renderPage();

    await screen.findByText("9/1(火)");
    expect(
      screen.queryByRole("button", { name: "前の期間からコピー" }),
    ).toBeNull();
  });

  it("is read-only once submissions are closed", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/shift/periods/period-1",
          json: data({ ...period, status: "building" }),
        },
        { url: "/api/shift/availability/period-1/me", json: submission([]) },
      ]),
    );

    renderPage();

    expect(await screen.findByText(/締め切られています/)).toBeTruthy();
    // Wait for the day rows themselves: the closed notice renders before the
    // list is loaded, so asserting on the buttons any earlier proves nothing.
    await screen.findByText("9/1(火)");
    expect(screen.queryByRole("button", { name: "提出する" })).toBeNull();
    expect(screen.queryByRole("button", { name: "下書き保存" })).toBeNull();
    expect(
      (screen.getAllByRole("button", { name: "休み" })[0] as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
