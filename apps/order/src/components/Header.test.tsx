import { render } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Header from "./Header";

describe("Header", () => {
  it("shows neither the subtitle twice nor a call button before a seat has loaded", () => {
    const { getAllByText, queryByRole } = render(() => (
      <Header seatName="" callOpen={false} onCallStaff={vi.fn()} />
    ));

    expect(getAllByText("セルフオーダー")).toHaveLength(1);
    expect(queryByRole("button", { name: "スタッフを呼ぶ" })).toBeNull();
  });

  it("renders the seat name and subtitle", () => {
    const { getByText } = render(() => (
      <Header seatName="テーブル1" callOpen={false} onCallStaff={vi.fn()} />
    ));

    expect(getByText("テーブル1")).toBeTruthy();
    expect(getByText("セルフオーダー")).toBeTruthy();
  });

  it("shows an enabled call-staff button with no status message when no call is open", () => {
    const { getByRole, queryByText } = render(() => (
      <Header seatName="テーブル1" callOpen={false} onCallStaff={vi.fn()} />
    ));

    const button = getByRole("button", { name: "スタッフを呼ぶ" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(queryByText("呼んでいます")).toBeNull();
  });

  it("shows a status message alongside the still-enabled button when a call is open", () => {
    const { getByRole, getByText } = render(() => (
      <Header seatName="テーブル1" callOpen={true} onCallStaff={vi.fn()} />
    ));

    expect(getByText("呼んでいます")).toBeTruthy();
    const button = getByRole("button", { name: "スタッフを呼ぶ" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls onCallStaff when the button is clicked", async () => {
    const onCallStaff = vi.fn();
    const user = userEvent.setup();
    const { getByRole } = render(() => (
      <Header seatName="テーブル1" callOpen={false} onCallStaff={onCallStaff} />
    ));

    await user.click(getByRole("button", { name: "スタッフを呼ぶ" }));

    expect(onCallStaff).toHaveBeenCalledOnce();
  });

  it("still allows tapping again while a call is already open (idempotent re-tap)", async () => {
    const onCallStaff = vi.fn();
    const user = userEvent.setup();
    const { getByRole } = render(() => (
      <Header seatName="テーブル1" callOpen={true} onCallStaff={onCallStaff} />
    ));

    await user.click(getByRole("button", { name: "スタッフを呼ぶ" }));

    expect(onCallStaff).toHaveBeenCalledOnce();
  });
});
