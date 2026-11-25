import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FriendsManager } from "./FriendsManager";
import { inviteCode } from "@/lib/social";
import type { SocialState } from "@/lib/social";

const mocks = vi.hoisted(() => ({ action: vi.fn(), data: null as SocialState | null }));
vi.mock("@/hooks/useSocial", () => ({
  useSocial: () => ({ data: mocks.data, isPending: false, isError: false }),
}));
vi.mock("@/lib/social.functions", () => ({ socialAction: mocks.action }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const token = "a".repeat(64);

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FriendsManager />
    </QueryClientProvider>,
  );
}

describe("Friends management", () => {
  beforeEach(() => {
    mocks.action.mockReset().mockResolvedValue({});
    mocks.data = {
      profile: {
        id,
        display_name: "Me",
        last_audience: "only_me",
        selected_friendship_ids: [],
        time_zone: "UTC",
      },
      friends: [],
      incoming: [],
      outgoing: [],
      blocked: [],
      invite: token,
    };
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("accepts codes and fragment-based links without putting tokens in server URL queries", () => {
    expect(inviteCode(token)).toBe(token);
    expect(inviteCode(`https://brushy.example/friends#invite=${token}`)).toBe(token);
    expect(() => inviteCode("not an invite")).toThrow("Paste a complete");
  });
  it("shows Pending versus Accept/Decline and never offers request cancellation", async () => {
    if (!mocks.data) throw new Error("Missing test state");
    mocks.data.incoming = [{ id, user_id: id, display_name: "Incoming person" }];
    mocks.data.outgoing = [
      { id: `${id.slice(0, -1)}2`, user_id: id, display_name: "Outgoing person" },
    ];
    show();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(mocks.action).toHaveBeenCalledWith({
        data: { action: "respond", data: { request_id: id, accept: true } },
      }),
    );
  });
  it("does not offer to send a crossed request when an incoming one already exists", async () => {
    mocks.action.mockResolvedValue({ user_id: id, display_name: "Ada", relationship: "incoming" });
    show();
    fireEvent.change(screen.getByPlaceholderText("Paste an invite link or code"), {
      target: { value: token },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up invite" }));
    expect(
      await screen.findByText("They already requested you. Accept or decline below."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send friend request" })).not.toBeInTheDocument();
  });
  it("surfaces friend-cap failures instead of reporting success or removing the request", async () => {
    if (!mocks.data) throw new Error("Missing test state");
    mocks.data.incoming = [{ id, user_id: id, display_name: "Ada" }];
    mocks.action.mockRejectedValue(new Error("Your friend list is full."));
    vi.spyOn(console, "error").mockImplementation(() => {});
    show();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your friend list is full");
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });
  it("requires a display name before exposing invite and social actions", () => {
    if (!mocks.data) throw new Error("Missing test state");
    mocks.data.profile = null;
    show();
    expect(screen.getByRole("button", { name: "Save name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Look up invite" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(token)).not.toBeInTheDocument();
  });
});
