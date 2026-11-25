import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FriendsFeed } from "./FriendsFeed";

const mocks = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("@/lib/social.functions", () => ({ socialAction: mocks.action }));
vi.mock("@/lib/selfie.functions", () => ({ deleteSelfie: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/PrivateSelfie", () => ({
  PrivateSelfie: ({ alt }: { alt: string }) => <div role="img" aria-label={alt} />,
}));
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const photo = {
  id,
  revision: other,
  owner_id: other,
  display_name: "Ada",
  streak: 7,
  local_date: "2026-11-25",
  slot: "am",
  verified: true,
  captured_at: "2026-11-25T10:00:00Z",
  audience: "all_friends",
};
function show(ownerId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FriendsFeed {...(ownerId ? { ownerId } : {})} />
    </QueryClientProvider>,
  );
}
describe("combined selfie feed", () => {
  beforeEach(() => {
    mocks.action.mockReset();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("shows owner and friend selfies with current streaks and loads authorized older pages", async () => {
    const cursor = { captured_at: photo.captured_at, id };
    mocks.action
      .mockResolvedValueOnce({ owner: null, items: [photo], next: cursor })
      .mockResolvedValueOnce({
        owner: null,
        items: [{ ...photo, id: other, owner_id: id, display_name: "Me", audience: "only_me" }],
        next: null,
      });
    show();
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete selfie" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load older selfies" }));
    expect(await screen.findByText("Me · You")).toBeInTheDocument();
    expect(screen.getByText("Only you")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Delete selfie" })).toHaveLength(1);
    expect(mocks.action).toHaveBeenLastCalledWith({ data: { action: "feed", data: { cursor } } });
    expect(screen.queryByRole("button", { name: "Load older selfies" })).not.toBeInTheDocument();
  });
  it("clears rendered photos when a refreshed profile loses authorization", async () => {
    mocks.action
      .mockResolvedValueOnce({
        owner: { user_id: other, display_name: "Ada", streak: 7 },
        items: [photo],
        next: null,
      })
      .mockRejectedValueOnce(new Error("This profile is unavailable."));
    show(other);
    await screen.findByRole("img", { name: "Ada brushing selfie" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("profile is unavailable");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("does not display cached friend selfies while offline", async () => {
    mocks.action.mockResolvedValue({ owner: null, items: [photo], next: null });
    show();
    await screen.findByRole("img");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reconnect to view shared selfies");
  });
});
