/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Member display names: set by the owner on invite or later, or by the member
 * themselves; read back wherever members are listed.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  grantProduct,
  jsonInit,
  seedMember,
  seedStore,
  withAuth,
} from "../test-helpers";

type Listed = { id: string; display_name: string | null };

async function listStaff(token: string): Promise<Listed[]> {
  const res = await app.request("/api/staff", withAuth(token), env);
  return ((await res.json()) as { data: Listed[] }).data;
}

describe("member display_name", () => {
  it("stores a trimmed name given on invite and lists it", async () => {
    const owner = await seedStore(`Name Invite ${crypto.randomUUID()}`);

    const res = await app.request(
      "/api/staff",
      withAuth(
        owner.session_token,
        jsonInit("POST", {
          email: `n-${crypto.randomUUID()}@test.internal`,
          display_name: "  山田 花子  ",
        }),
      ),
      env,
    );
    expect(res.status).toBe(201);
    const created = ((await res.json()) as { data: Listed }).data;
    expect(created.display_name).toBe("山田 花子");

    const listed = await listStaff(owner.session_token);
    expect(listed.find((m) => m.id === created.id)?.display_name).toBe(
      "山田 花子",
    );
  });

  it("lets the owner rename a member and clear the name with a blank", async () => {
    const owner = await seedStore(`Name Edit ${crypto.randomUUID()}`);
    const staff = await seedMember(owner.id, "staff");
    const path = `/api/staff/${staff.member_id}`;

    const res = await app.request(
      path,
      withAuth(
        owner.session_token,
        jsonInit("PATCH", { display_name: "佐藤" }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(
      (await listStaff(owner.session_token)).find(
        (m) => m.id === staff.member_id,
      )?.display_name,
    ).toBe("佐藤");

    await app.request(
      path,
      withAuth(owner.session_token, jsonInit("PATCH", { display_name: " " })),
      env,
    );
    expect(
      (await listStaff(owner.session_token)).find(
        (m) => m.id === staff.member_id,
      )?.display_name,
    ).toBeNull();
  });

  it("rejects a name over 50 characters", async () => {
    const owner = await seedStore(`Name Long ${crypto.randomUUID()}`);
    const res = await app.request(
      `/api/staff/${owner.member_id}`,
      withAuth(
        owner.session_token,
        jsonInit("PATCH", { display_name: "あ".repeat(51) }),
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for another store's member, and 403 for a staff session", async () => {
    const owner = await seedStore(`Name Tenant ${crypto.randomUUID()}`);
    const other = await seedStore(`Name Other ${crypto.randomUUID()}`);
    const staff = await seedMember(owner.id, "staff");

    const crossTenant = await app.request(
      `/api/staff/${staff.member_id}`,
      withAuth(
        other.session_token,
        jsonInit("PATCH", { display_name: "乗っ取り" }),
      ),
      env,
    );
    expect(crossTenant.status).toBe(404);

    const asStaff = await app.request(
      `/api/staff/${owner.member_id}`,
      withAuth(staff.session_token, jsonInit("PATCH", { display_name: "x" })),
      env,
    );
    expect(asStaff.status).toBe(403);
  });

  it("lets any member set their own name, returned by /api/auth/me", async () => {
    const owner = await seedStore(`Name Self ${crypto.randomUUID()}`);
    const staff = await seedMember(owner.id, "staff");

    const res = await app.request(
      "/api/auth/me",
      withAuth(
        staff.session_token,
        jsonInit("PATCH", { display_name: "鈴木" }),
      ),
      env,
    );
    expect(res.status).toBe(200);

    const me = await app.request(
      "/api/auth/me",
      withAuth(staff.session_token),
      env,
    );
    expect(
      ((await me.json()) as { data: { display_name: string | null } }).data
        .display_name,
    ).toBe("鈴木");
  });

  it("is included in the shift roster", async () => {
    const owner = await seedStore(`Name Shift ${crypto.randomUUID()}`);
    await grantProduct(owner.id, "shift");
    await app.request(
      `/api/staff/${owner.member_id}`,
      withAuth(
        owner.session_token,
        jsonInit("PATCH", { display_name: "店長" }),
      ),
      env,
    );

    const res = await app.request(
      "/api/shift/members",
      withAuth(owner.session_token),
      env,
    );
    const roster = (await res.json()) as { data: Listed[] };
    expect(roster.data[0]?.display_name).toBe("店長");
  });
});
