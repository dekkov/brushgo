import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateSelfie } from "./PrivateSelfie";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.session } },
}));
describe("authenticated feed photos", () => {
  const create = vi.fn();
  const revoke = vi.fn();
  beforeEach(() => {
    mocks.session.mockResolvedValue({
      data: { session: { user: { id: "viewer" }, access_token: "private-token" } },
    });
    create.mockReset().mockReturnValue("blob:test-photo");
    revoke.mockReset();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = create;
        static override revokeObjectURL = revoke;
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("uses an Authorization header rather than exposing access tokens or signed URLs in image src", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("jpeg", { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(
      <PrivateSelfie id="photo" revision="revision" viewerId="viewer" alt="Friend selfie" />,
    );
    expect(await screen.findByAltText("Friend selfie")).toHaveAttribute("src", "blob:test-photo");
    expect(fetch).toHaveBeenCalledWith(
      "/api/selfies/photo?revision=revision",
      expect.objectContaining({
        headers: { Authorization: "Bearer private-token" },
        cache: "no-store",
      }),
    );
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:test-photo");
  });
  it("refuses to load photos using a different account's session", async () => {
    mocks.session.mockResolvedValue({
      data: { session: { user: { id: "another-user" }, access_token: "other-token" } },
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PrivateSelfie id="photo" revision="revision" viewerId="viewer" alt="Friend selfie" />);
    expect(await screen.findByRole("status")).toHaveTextContent("Sign in again");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("clears the previous blob when a replacement revision becomes unavailable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("jpeg", { headers: { "content-type": "image/jpeg" } }))
      .mockResolvedValueOnce(new Response("revoked", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const view = render(
      <PrivateSelfie id="photo" revision="old" viewerId="viewer" alt="Friend selfie" />,
    );
    await screen.findByAltText("Friend selfie");
    view.rerender(
      <PrivateSelfie id="photo" revision="new" viewerId="viewer" alt="Friend selfie" />,
    );
    await waitFor(() => expect(screen.queryByAltText("Friend selfie")).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent("no longer shared");
    expect(revoke).toHaveBeenCalledWith("blob:test-photo");
  });
});
