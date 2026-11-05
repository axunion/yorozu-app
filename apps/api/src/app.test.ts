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

describe("CORS response headers", () => {
  it("allows PUT in a preflight from an allowed Origin (menu photo upload)", async () => {
    const res = await app.request(
      "/api/menu/items/any/image",
      {
        method: "OPTIONS",
        headers: {
          Origin: env.ADMIN_ORIGIN,
          "Access-Control-Request-Method": "PUT",
        },
      },
      env,
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });

  it("keeps CORS headers on an error response so the SPA can read its message", async () => {
    const res = await app.request(
      `/api/order/${crypto.randomUUID()}`,
      { headers: { Origin: env.ORDER_ORIGIN } },
      env,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      env.ORDER_ORIGIN,
    );
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("keeps CORS headers on an auth middleware rejection", async () => {
    const res = await app.request(
      "/api/admin/orders",
      { headers: { Origin: env.ADMIN_ORIGIN } },
      env,
    );

    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      env.ADMIN_ORIGIN,
    );
  });

  it("sets no Access-Control-Allow-Origin for a disallowed Origin", async () => {
    const res = await app.request(
      `/api/order/${crypto.randomUUID()}`,
      { headers: { Origin: "http://evil.example" } },
      env,
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
