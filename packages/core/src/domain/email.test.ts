import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEmailContent, sendVerificationCodeEmail } from "./email";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("buildEmailContent", () => {
  it("embeds the code in the signup email", () => {
    const { subject, html } = buildEmailContent("signup", "123456");
    expect(subject).toContain("確認");
    expect(html).toContain("123456");
  });

  it("embeds the code in the login email", () => {
    const { subject, html } = buildEmailContent("login", "234567");
    expect(subject).toContain("ログイン");
    expect(html).toContain("234567");
  });

  it("embeds the code in the email_change email", () => {
    const { subject, html } = buildEmailContent("email_change", "345678");
    expect(subject).toContain("メールアドレス変更");
    expect(html).toContain("345678");
  });

  it("embeds the code in the invite email", () => {
    const { subject, html } = buildEmailContent("invite", "456789");
    expect(subject).toContain("招待");
    expect(html).toContain("456789");
  });

  it("embeds the code in the reactivate email", () => {
    const { subject, html } = buildEmailContent("reactivate", "567890");
    expect(subject).toContain("再開");
    expect(html).toContain("567890");
  });

  it("produces distinct content per purpose", () => {
    const subjects = (
      ["signup", "login", "email_change", "invite", "reactivate"] as const
    ).map((purpose) => buildEmailContent(purpose, "123456").subject);
    expect(new Set(subjects).size).toBe(subjects.length);
  });

  it("keeps a leading zero in the rendered code", () => {
    const { html } = buildEmailContent("login", "012345");
    expect(html).toContain("012345");
  });

  it("renders the landing URL when one is supplied", () => {
    const { html } = buildEmailContent(
      "invite",
      "123456",
      "https://admin.example.com/login?email=staff%40example.com",
    );
    expect(html).toContain(
      "https://admin.example.com/login?email=staff%40example.com",
    );
  });

  it("carries no link at all when no landing URL is supplied", () => {
    // The whole point of moving off Magic Links: a mail-security scanner that
    // follows links ahead of the recipient must have nothing to follow.
    for (const purpose of [
      "signup",
      "login",
      "email_change",
      "reactivate",
    ] as const) {
      const { html } = buildEmailContent(purpose, "123456");
      expect(html).not.toContain("<a href");
    }
  });
});

describe("sendVerificationCodeEmail", () => {
  it("logs the code to the console instead of calling fetch when resendApiKey is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendVerificationCodeEmail(
      { to: "owner@example.com", code: "123456", purpose: "login" },
      {},
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("owner@example.com"),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });

  it("calls the Resend API with the purpose's subject and the code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await sendVerificationCodeEmail(
      {
        to: "newowner@example.com",
        code: "654321",
        purpose: "email_change",
      },
      { resendApiKey: "test-key" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("newowner@example.com");
    expect(body.subject).toContain("メールアドレス変更");
    expect(body.html).toContain("654321");
  });

  it("throws when the Resend API responds with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      }),
    );

    await expect(
      sendVerificationCodeEmail(
        { to: "owner@example.com", code: "123456", purpose: "login" },
        { resendApiKey: "test-key" },
      ),
    ).rejects.toThrow(/Resend API error/);
  });
});
