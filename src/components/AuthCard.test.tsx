import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCard } from "./AuthCard";

const signInWithOAuth = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args: unknown[]) => signInWithOAuth(...args),
    },
  },
}));

describe("AuthCard", () => {
  beforeEach(() => {
    signInWithOAuth.mockReset();
    signInWithOAuth.mockResolvedValue({ error: null });
  });

  it("uses Supabase Google authentication with the current origin", async () => {
    render(<AuthCard />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() =>
      expect(signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: window.location.origin },
      }),
    );
    expect(
      screen.queryByRole("button", { name: /continue with lovable/i }),
    ).not.toBeInTheDocument();
  });
});
