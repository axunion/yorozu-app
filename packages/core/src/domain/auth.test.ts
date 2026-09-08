import { describe, expect, it } from "vitest";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  generateOtpCode,
  hashOtpCode,
  MAGIC_LINK_HOURLY_CAP,
  MAGIC_LINK_TTL_MS,
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  SESSION_TOKEN_COOKIE,
  SESSION_TTL_MS,
} from "./auth";

describe("SESSION_TOKEN_COOKIE", () => {
  it("is the string 'session_token'", () => {
    expect(SESSION_TOKEN_COOKIE).toBe("session_token");
  });
});

describe("SESSION_TTL_MS", () => {
  it("is 30 days in milliseconds", () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("MAGIC_LINK_TTL_MS", () => {
  it("is 15 minutes in milliseconds", () => {
    expect(MAGIC_LINK_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe("MAGIC_LINK_HOURLY_CAP", () => {
  it("is 5", () => {
    expect(MAGIC_LINK_HOURLY_CAP).toBe(5);
  });
});

describe("buildSessionCookie", () => {
  it("includes the token value", () => {
    const cookie = buildSessionCookie("my-token-abc");
    expect(cookie).toContain("session_token=my-token-abc");
  });

  it("sets HttpOnly flag", () => {
    const cookie = buildSessionCookie("tok");
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("sets SameSite=None for cross-origin support", () => {
    const cookie = buildSessionCookie("tok");
    expect(cookie.toLowerCase()).toContain("samesite=none");
  });

  it("sets Path=/", () => {
    const cookie = buildSessionCookie("tok");
    expect(cookie).toContain("Path=/");
  });

  it("sets Max-Age to 30 days in seconds", () => {
    const cookie = buildSessionCookie("tok");
    const expectedMaxAge = Math.floor(SESSION_TTL_MS / 1000);
    expect(cookie).toContain(`Max-Age=${expectedMaxAge}`);
  });

  it("does NOT include Secure by default", () => {
    const cookie = buildSessionCookie("tok");
    expect(cookie.toLowerCase()).not.toContain("secure");
  });

  it("includes Secure when secure=true", () => {
    const cookie = buildSessionCookie("tok", { secure: true });
    expect(cookie.toLowerCase()).toContain("secure");
  });

  it("includes Domain when domain is provided", () => {
    const cookie = buildSessionCookie("tok", { domain: ".example.com" });
    expect(cookie).toContain("Domain=.example.com");
  });

  it("does NOT include Domain when domain is omitted", () => {
    const cookie = buildSessionCookie("tok");
    expect(cookie.toLowerCase()).not.toContain("domain");
  });
});

describe("buildClearSessionCookie", () => {
  it("sets Max-Age=0 to expire the cookie immediately", () => {
    const cookie = buildClearSessionCookie();
    expect(cookie).toContain("Max-Age=0");
  });

  it("sets HttpOnly flag", () => {
    const cookie = buildClearSessionCookie();
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("sets Path=/", () => {
    const cookie = buildClearSessionCookie();
    expect(cookie).toContain("Path=/");
  });

  it("sets SameSite=None", () => {
    const cookie = buildClearSessionCookie();
    expect(cookie.toLowerCase()).toContain("samesite=none");
  });

  it("includes Secure when secure=true", () => {
    const cookie = buildClearSessionCookie({ secure: true });
    expect(cookie.toLowerCase()).toContain("secure");
  });

  it("includes Domain when domain is provided", () => {
    const cookie = buildClearSessionCookie({ domain: ".example.com" });
    expect(cookie).toContain("Domain=.example.com");
  });
});

describe("OTP_TTL_MS", () => {
  it("is 10 minutes in milliseconds", () => {
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("is shorter than a Magic Link's lifetime", () => {
    expect(OTP_TTL_MS).toBeLessThan(MAGIC_LINK_TTL_MS);
  });
});

describe("OTP_MAX_ATTEMPTS", () => {
  it("is 5", () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });
});

describe("generateOtpCode", () => {
  // One sample proves the shape; the sweep below is what catches a generator
  // that has collapsed to a constant or drifted out of range.
  const samples = Array.from({ length: 2000 }, () => generateOtpCode());

  it("returns OTP_CODE_LENGTH digits", () => {
    for (const code of samples) {
      expect(code).toMatch(/^\d{6}$/);
      expect(code).toHaveLength(OTP_CODE_LENGTH);
    }
  });

  it("keeps leading zeros rather than shortening the code", () => {
    // ~10% of codes are below 100000, so 2000 samples without one would mean
    // padStart is broken, not that the draw was unlucky.
    expect(samples.some((code) => code.startsWith("0"))).toBe(true);
  });

  it("covers the whole 0-999999 range", () => {
    const values = samples.map(Number);
    expect(Math.min(...values)).toBeLessThan(100_000);
    expect(Math.max(...values)).toBeGreaterThan(900_000);
  });

  it("does not repeat itself", () => {
    // Birthday collisions in 2000 draws from 10^6 are expected (~2 pairs), so
    // assert on the bulk being distinct rather than on perfect uniqueness.
    expect(new Set(samples).size).toBeGreaterThan(1900);
  });
});

describe("hashOtpCode", () => {
  const pepper = "test-pepper";

  it("returns a 64-character hex digest", async () => {
    const digest = await hashOtpCode("row-1", "123456", pepper);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", async () => {
    const a = await hashOtpCode("row-1", "123456", pepper);
    const b = await hashOtpCode("row-1", "123456", pepper);
    expect(a).toBe(b);
  });

  it("differs by row id, so two rows never collide on the same code", async () => {
    const a = await hashOtpCode("row-1", "123456", pepper);
    const b = await hashOtpCode("row-2", "123456", pepper);
    expect(a).not.toBe(b);
  });

  it("differs by code", async () => {
    const a = await hashOtpCode("row-1", "123456", pepper);
    const b = await hashOtpCode("row-1", "123457", pepper);
    expect(a).not.toBe(b);
  });

  it("differs by pepper, so the digest is not brute-forceable from D1 alone", async () => {
    const a = await hashOtpCode("row-1", "123456", pepper);
    const b = await hashOtpCode("row-1", "123456", "other-pepper");
    expect(a).not.toBe(b);
  });

  it("throws when the pepper is missing instead of falling back to an unkeyed hash", async () => {
    await expect(hashOtpCode("row-1", "123456", "")).rejects.toThrow(
      "OTP_PEPPER",
    );
  });
});
