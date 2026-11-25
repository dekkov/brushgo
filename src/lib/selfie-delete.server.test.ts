// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { deleteOwnedSelfie } from "./selfie-delete.server";
import { deleteSelfieObject } from "./selfie-storage.server";

vi.mock("./selfie-storage.server", () => ({ deleteSelfieObject: vi.fn() }));
const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";
const key = `${owner}/${revision}.jpg`;
const photo = { id, photo_path: `s3:${key}` };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createClient<Database>("https://supabase.example", "public-key", {
    global: { fetch, headers: { Authorization: "Bearer owner-session" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { fetch, remove: () => deleteOwnedSelfie(client, owner, id, revision) };
}

describe("owner-only selfie and check-in deletion", () => {
  beforeEach(() => {
    vi.mocked(deleteSelfieObject).mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it("deletes the authorized image before removing only the matching owner's revision", async () => {
    const { fetch, remove } = fixture();
    const events: string[] = [];
    fetch
      .mockImplementationOnce(async () => {
        events.push("lookup");
        return json([photo]);
      })
      .mockImplementationOnce(async () => {
        events.push("row");
        return json([{ id }]);
      });
    vi.mocked(deleteSelfieObject).mockImplementation(async () => {
      events.push("image");
    });
    await remove();
    expect(events).toEqual(["lookup", "image", "row"]);
    expect(deleteSelfieObject).toHaveBeenCalledWith(key);
    for (const [url] of fetch.mock.calls) {
      const params = new URL(String(url)).searchParams;
      expect(params.get("user_id")).toBe(`eq.${owner}`);
      expect(params.get("id")).toBe(`eq.${id}`);
      expect(params.get("revision")).toBe(`eq.${revision}`);
    }
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("does not touch storage or delete rows for an unavailable or non-owned revision", async () => {
    const { fetch, remove } = fixture();
    fetch.mockResolvedValueOnce(json([]));
    await expect(remove()).rejects.toThrow("deleted or replaced");
    expect(deleteSelfieObject).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("surfaces lookup failures before touching storage", async () => {
    const { fetch, remove } = fixture();
    fetch.mockResolvedValueOnce(json({ message: "Permission denied" }, 403));
    await expect(remove()).rejects.toThrow("Could not load this selfie");
    expect(deleteSelfieObject).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    `s3:44444444-4444-4444-8444-444444444444/${revision}.jpg`,
    `${owner}/../someone-else.jpg`,
    "someone-else/photo.jpg",
  ])("rejects an invalid owned storage path: %s", async (path) => {
    const { fetch, remove } = fixture();
    fetch.mockResolvedValueOnce(json([{ ...photo, photo_path: path }]));
    await expect(remove()).rejects.toThrow("Could not delete the stored image");
    expect(deleteSelfieObject).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps the check-in when S3 deletion fails", async () => {
    const { fetch, remove } = fixture();
    fetch.mockResolvedValueOnce(json([photo]));
    vi.mocked(deleteSelfieObject).mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(remove()).rejects.toThrow("Check storage delete permissions");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reports partial failure and lets the owner retry after storage already succeeded", async () => {
    const { fetch, remove } = fixture();
    fetch
      .mockResolvedValueOnce(json([photo]))
      .mockResolvedValueOnce(json({ message: "Database unavailable" }, 503))
      .mockResolvedValueOnce(json([photo]))
      .mockResolvedValueOnce(json([{ id }]));
    await expect(remove()).rejects.toThrow("stored image was deleted");
    await expect(remove()).resolves.toBeUndefined();
    expect(deleteSelfieObject).toHaveBeenCalledTimes(2);
  });

  it("does not remove a replacement check-in if its revision changed during deletion", async () => {
    const { fetch, remove } = fixture();
    fetch.mockResolvedValueOnce(json([photo])).mockResolvedValueOnce(json([]));
    await expect(remove()).rejects.toThrow("selfie changed");
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get("revision")).toBe(
      `eq.${revision}`,
    );
    expect(deleteSelfieObject).toHaveBeenCalledWith(key);
  });

  it("deletes legacy images through the owner's authenticated Supabase Storage client", async () => {
    const { fetch, remove } = fixture();
    const path = `${owner}/legacy.jpg`;
    fetch
      .mockResolvedValueOnce(json([{ ...photo, photo_path: path }]))
      .mockResolvedValueOnce(json([{ name: "legacy.jpg" }]))
      .mockResolvedValueOnce(json([{ id }]));
    await remove();
    const [url, options] = fetch.mock.calls[1]!;
    expect(String(url)).toBe("https://supabase.example/storage/v1/object/selfies");
    expect(options?.method).toBe("DELETE");
    expect(JSON.parse(String(options?.body))).toEqual({ prefixes: [path] });
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer owner-session");
    expect(deleteSelfieObject).not.toHaveBeenCalled();
    expect(fetch.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });

  it("keeps the check-in when legacy storage deletion fails", async () => {
    const { fetch, remove } = fixture();
    fetch
      .mockResolvedValueOnce(json([{ ...photo, photo_path: `${owner}/legacy.jpg` }]))
      .mockResolvedValueOnce(json({ message: "Forbidden" }, 403));
    await expect(remove()).rejects.toThrow("Could not delete the stored image");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
