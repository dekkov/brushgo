// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveSocialPhoto } from "./social-photo.server";
import { socialRpc, SocialError } from "./social-rpc.server";
import { readSelfie } from "./selfie-storage.server";

vi.mock("./social-rpc.server", async (original) => ({
  ...(await original<typeof import("./social-rpc.server")>()),
  socialRpc: vi.fn(),
}));
vi.mock("./selfie-storage.server", () => ({ readSelfie: vi.fn() }));
const owner = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const path = `s3:${owner}/${revision}.jpg`;
const request = () =>
  new Request(`https://brushy.example/api/selfies/${owner}?revision=${revision}`, {
    headers: { Authorization: "Bearer session" },
  });

describe("per-request photo authorization", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("authorizes the exact revision before streaming, with caching disabled", async () => {
    vi.mocked(socialRpc).mockResolvedValue({ photo_path: path, owner_id: owner });
    vi.mocked(readSelfie).mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("jpeg"));
          controller.close();
        },
      }),
    );
    const response = await serveSocialPhoto(request(), owner);
    expect(socialRpc).toHaveBeenCalledWith(
      { action: "photo", data: { id: owner, revision } },
      expect.any(Request),
    );
    expect(readSelfie).toHaveBeenCalledWith(`${owner}/${revision}.jpg`, expect.any(AbortSignal));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(response.headers.has("location")).toBe(false);
    expect(await response.text()).toBe("jpeg");
  });
  it.each(["removed friend", "blocked", "replaced photo", "private audience"])(
    "denies %s before touching S3",
    async () => {
      vi.mocked(socialRpc).mockRejectedValue(new SocialError("Unavailable"));
      const response = await serveSocialPhoto(request(), owner);
      expect(response.status).toBe(404);
      expect(readSelfie).not.toHaveBeenCalled();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("rejects malformed or missing revisions", async () => {
    const response = await serveSocialPhoto(
      new Request("https://brushy.example/api/selfies/test"),
      "test",
    );
    expect(response.status).toBe(400);
    expect(socialRpc).not.toHaveBeenCalled();
    expect(readSelfie).not.toHaveBeenCalled();
  });
  it("checks again on every request rather than reusing a prior authorization", async () => {
    vi.mocked(socialRpc)
      .mockResolvedValueOnce({ photo_path: path, owner_id: owner })
      .mockRejectedValueOnce(new SocialError("Removed"));
    vi.mocked(readSelfie).mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    );
    expect((await serveSocialPhoto(request(), owner)).status).toBe(200);
    expect((await serveSocialPhoto(request(), owner)).status).toBe(404);
    expect(socialRpc).toHaveBeenCalledTimes(2);
    expect(readSelfie).toHaveBeenCalledOnce();
  });
  it("streams owner-authorized legacy storage photos without emitting a signed URL", async () => {
    vi.stubEnv("SUPABASE_URL", "https://supabase.example");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "public-key");
    vi.mocked(socialRpc).mockResolvedValue({ photo_path: `${owner}/legacy.jpg`, owner_id: owner });
    const fetch = vi.fn().mockResolvedValue(new Response("legacy-jpeg"));
    vi.stubGlobal("fetch", fetch);
    const response = await serveSocialPhoto(request(), owner);
    expect(await response.text()).toBe("legacy-jpeg");
    expect(fetch).toHaveBeenCalledWith(
      `https://supabase.example/storage/v1/object/authenticated/selfies/${owner}/legacy.jpg`,
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
    expect(response.headers.has("location")).toBe(false);
    expect(readSelfie).not.toHaveBeenCalled();
  });
});
