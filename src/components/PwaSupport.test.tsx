import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PwaSupport } from "./PwaSupport";

vi.mock("@/lib/pwa", () => ({ registerServiceWorker: vi.fn() }));

function mobile(userAgent = "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36") {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe("PWA support", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Desktop Chrome/130.0");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps install guidance and prompt suppression off desktop", () => {
    render(<PwaSupport />);
    const event = installEvent();
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByLabelText("Install Brushy")).not.toBeInTheDocument();
  });

  it("shows Android instructions without pretending a native prompt is available", () => {
    mobile();
    render(<PwaSupport />);
    expect(screen.getByLabelText("Install Brushy")).toHaveTextContent("In Chrome");
    expect(screen.queryByRole("button", { name: "Install Brushy" })).not.toBeInTheDocument();
  });

  it("uses a real browser prompt once and hides guidance on acceptance", async () => {
    mobile();
    render(<PwaSupport />);
    const event = installEvent();
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Install Brushy" }));
    await waitFor(() => expect(event.prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByLabelText("Install Brushy")).not.toBeInTheDocument());
  });

  it("falls back to manual instructions when the browser prompt is declined", async () => {
    mobile();
    render(<PwaSupport />);
    installEvent("dismissed");
    fireEvent.click(screen.getByRole("button", { name: "Install Brushy" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Install Brushy" })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Install Brushy")).toBeInTheDocument();
  });

  it("surfaces prompt errors and retains manual installation guidance", async () => {
    mobile();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PwaSupport />);
    const event = installEvent();
    event.prompt.mockRejectedValue(new Error("not allowed"));
    fireEvent.click(screen.getByRole("button", { name: "Install Brushy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Installation could not open");
    expect(screen.getByLabelText("Install Brushy")).toHaveTextContent("In Chrome");
  });

  it("shows Safari instructions for iOS", () => {
    mobile("Mozilla/5.0 (iPhone) Version/18.0 Mobile/15E148 Safari/604.1");
    render(<PwaSupport />);
    expect(screen.getByLabelText("Install Brushy")).toHaveTextContent("In Safari, open Share");
  });

  it("hides guidance in standalone mode and after installation", () => {
    mobile();
    render(<PwaSupport />);
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.queryByLabelText("Install Brushy")).not.toBeInTheDocument();
    cleanup();
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    render(<PwaSupport />);
    expect(screen.queryByLabelText("Install Brushy")).not.toBeInTheDocument();
    Reflect.deleteProperty(navigator, "standalone");
  });

  it("responds to standalone display-mode changes", () => {
    mobile();
    const display = Object.assign(new EventTarget(), { matches: false });
    vi.spyOn(window, "matchMedia").mockReturnValue(display as MediaQueryList);
    render(<PwaSupport />);
    act(() => {
      display.matches = true;
      display.dispatchEvent(new Event("change"));
    });
    expect(screen.queryByLabelText("Install Brushy")).not.toBeInTheDocument();
  });

  it("announces connection loss and recovery without removing page state", () => {
    const state = vi.spyOn(navigator, "onLine", "get");
    render(
      <>
        <PwaSupport />
        <input aria-label="Unsaved state" defaultValue="keep me" />
      </>,
    );
    state.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("You are offline");
    state.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Unsaved state")).toHaveValue("keep me");
  });

  it("cleans up browser event listeners", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<PwaSupport />);
    unmount();
    for (const event of ["beforeinstallprompt", "appinstalled", "online", "offline"]) {
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function));
    }
  });

  // Last because the in-memory fallback intentionally lasts for the browser session.
  it("remembers dismissal across remounts for the browser session", () => {
    mobile();
    render(<PwaSupport />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss install guidance" }));
    expect(sessionStorage.getItem("brushy-install-dismissed")).toBe("true");
    cleanup();
    render(<PwaSupport />);
    expect(screen.queryByLabelText("Install Brushy")).not.toBeInTheDocument();
  });
});
