import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/capture";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  upload: vi.fn(),
  upsert: vi.fn().mockResolvedValue({ error: null }),
  social: { profile: null, friends: [] },
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-user" } }) }));
vi.mock("@/lib/detector", () => ({
  loadDetector: () => Promise.resolve({}),
  detect: () => Promise.resolve({ person: 1, toothbrush: 1 }),
  isVerified: () => true,
}));
vi.mock("@/lib/selfie.functions", () => ({ createSelfieUpload: mocks.upload }));
vi.mock("@/lib/social.functions", () => ({
  socialAction: (...args: unknown[]) => mocks.upsert(...args),
}));
vi.mock("@/hooks/useSocial", () => ({
  useSocial: () => ({ data: mocks.social, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ upsert: mocks.upsert }) },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const CapturePage = Route.options.component!;
function Page() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <CapturePage />
    </QueryClientProvider>
  );
}
const originalGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  "getContext",
)!;

describe("PWA connection loss during capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        translate: vi.fn(),
        scale: vi.fn(),
        drawImage: vi.fn(),
        setTransform: vi.fn(),
      })),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["selfie"], { type: "image/jpeg" }));
    });
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = vi.fn().mockReturnValue("blob:test-selfie");
      },
    );
    mocks.upload.mockResolvedValue({
      path: "test-user/selfie.jpg",
      url: "https://uploads.invalid/selfie",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("disables capture offline and cancels an in-flight countdown", async () => {
    render(<Page />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Take selfie" }));
    expect(screen.getByText("3")).toBeInTheDocument();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByRole("button", { name: "Take selfie" })).toBeDisabled();
    expect(screen.queryByAltText("Your selfie")).not.toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("retains a shot offline and saves it only after an explicit online retry", async () => {
    render(<Page />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Take selfie" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByAltText("Your selfie")).toHaveAttribute("src", "blob:test-selfie");
    const state = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("button", { name: "Log it" })).toBeDisabled();
    expect(screen.getByAltText("Your selfie")).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
    state.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    });
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("retains the shot and shows failure if a reported-online save loses the network", async () => {
    mocks.upload.mockRejectedValue(new Error("network lost"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Page />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Take selfie" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    });
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Could not save your check-in. Please try again.",
    );
    expect(screen.getByAltText("Your selfie")).toBeInTheDocument();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
