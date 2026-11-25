// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialError, socialRpc } from "./social-rpc.server";

const request = () =>
  new Request("https://brushy.example", {
    headers: { authorization: "Bearer user-session-token" },
  });

describe("social RPC boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function setup() {
    vi.stubEnv("SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "public-key");
  }
  it("requires authentication before contacting the database", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      socialRpc({ action: "state", data: {} }, new Request("https://brushy.example")),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("forwards the user's token, never a service-role credential", async () => {
    setup();
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await socialRpc({ action: "state", data: {} }, request());
    expect(fetch).toHaveBeenCalledWith(
      "https://supabase.example/rest/v1/rpc/brushy_social",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer user-session-token",
          apikey: "public-key",
        }),
        cache: "no-store",
        body: JSON.stringify({ p_action: "state", p_data: {} }),
      }),
    );
  });
  it("reports missing SQL explicitly rather than an empty success state", async () => {
    setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code: "PGRST202", message: "missing function" }, { status: 404 }),
        ),
    );
    await expect(socialRpc({ action: "state", data: {} }, request())).rejects.toThrow(
      "Apply the Friends SQL",
    );
  });
  it("preserves deliberate database user messages but not internal SQL errors", async () => {
    setup();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: "P0001", message: "Your friend list is full." }, { status: 400 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(socialRpc({ action: "state", data: {} }, request())).rejects.toThrow(
      "Your friend list is full.",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetch.mockResolvedValue(
      Response.json({ code: "42501", message: "internal table name" }, { status: 403 }),
    );
    await expect(socialRpc({ action: "state", data: {} }, request())).rejects.toThrow(
      "Could not complete the Friends request",
    );
  });
});
