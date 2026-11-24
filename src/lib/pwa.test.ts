import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./pwa";
import { reportLovableError } from "./lovable-error-reporting";

vi.mock("./lovable-error-reporting", () => ({ reportLovableError: vi.fn() }));

describe("worker registration", () => {
  const register = vi.fn();
  beforeEach(() => {
    vi.stubEnv("PROD", true);
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register } });
    register.mockReset().mockResolvedValue({});
    vi.mocked(reportLovableError).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
    vi.restoreAllMocks();
  });
  it("registers the root worker without a stale HTTP-cached script", async () => {
    await registerServiceWorker();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });
  it("does not register in development", async () => {
    vi.stubEnv("PROD", false);
    await registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });
  it("does not register in insecure or unsupported browsers", async () => {
    vi.stubGlobal("isSecureContext", false);
    await registerServiceWorker();
    vi.stubGlobal("isSecureContext", true);
    Reflect.deleteProperty(navigator, "serviceWorker");
    await registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
  });
  it("logs and reports registration failure without breaking the app", async () => {
    const error = new Error("worker unavailable");
    register.mockRejectedValue(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(registerServiceWorker()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.any(String), error);
    expect(reportLovableError).toHaveBeenCalledWith(error, { feature: "pwa_registration" });
  });
});
