/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("CORS / CSRF origin enforcement", () => {
  it("rejects a state-changing request from a disallowed Origin with 403", async () => {
    const res = await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { Origin: "http://evil.example" } },
      env,
    );

    expect(res.status).toBe(403);
  });

  it("allows a state-changing request from an allowed Origin", async () => {
    const res = await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { Origin: env.ADMIN_ORIGIN } },
      env,
    );

    expect(res.status).not.toBe(403);
  });

  it("allows a state-changing request with no Origin header (non-browser client)", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" }, env);

    expect(res.status).not.toBe(403);
  });

  it("does not reject a GET request from a disallowed Origin", async () => {
    const res = await app.request(
      "/api/auth/me",
      { method: "GET", headers: { Origin: "http://evil.example" } },
      env,
    );

    expect(res.status).not.toBe(403);
  });
});
