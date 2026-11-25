import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const publicFile = (name: string) => readFileSync(resolve("public", name.replace(/^\//, "")));
const workerSource = publicFile("sw.js").toString();

function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const fallback = {
    body: "Offline page",
    headers: { "content-type": "text/html" },
    redirected: true,
  };
  const cache = {
    add: vi.fn<(request: unknown) => Promise<void>>().mockResolvedValue(undefined),
    match: vi.fn<(url: string) => Promise<unknown>>().mockResolvedValue(fallback),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(["brushy-offline-v0", "brushy-offline-v1", "another-app"]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  runInNewContext(workerSource, {
    self: {
      location: { origin: "https://brushy.example" },
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        listeners.set(name, handler),
      skipWaiting,
      clients: { claim },
    },
    caches,
    fetch,
    URL,
    Request: class {
      constructor(
        public url: string,
        public options: unknown,
      ) {}
    },
    Response: class {
      constructor(
        public body: unknown,
        public options: unknown,
      ) {}
      static error() {
        return { error: true };
      }
    },
    Set,
    Promise,
  });
  function navigate(path = "/", overrides = {}) {
    const respondWith = vi.fn();
    listeners.get("fetch")!({
      request: {
        url: `https://brushy.example${path}`,
        mode: "navigate",
        method: "GET",
        ...overrides,
      },
      respondWith,
    });
    return respondWith;
  }
  return { listeners, cache, caches, fetch, fallback, skipWaiting, claim, navigate };
}

describe("PWA assets", () => {
  it("has standalone Brushy metadata and valid PNG icon sizes", () => {
    const manifest = JSON.parse(publicFile("manifest.webmanifest").toString());
    expect(manifest).toMatchObject({
      name: "Brushy",
      short_name: "Brushy",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    for (const icon of manifest.icons) {
      const png = publicFile(icon.src);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
    const apple = publicFile("icons/apple-touch-icon.png");
    expect([apple.readUInt32BE(16), apple.readUInt32BE(20)]).toEqual([180, 180]);
    const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
    expect(root).toContain('rel: "manifest"');
    expect(root).toContain('href: "/manifest.webmanifest"');
    expect(root).toContain('rel: "apple-touch-icon"');
    expect(root).toContain("viewport-fit=cover");
  });

  it("provides an entirely self-contained offline page", () => {
    const html = publicFile("offline.html").toString();
    expect(html).toContain("Brushy needs a connection");
    expect(html).toContain("window.location.reload()");
    expect(html).not.toMatch(/<(?:link|img|script)[^>]+(?:src|href)=/);
  });
});

describe("offline worker", () => {
  it("precaches only the public offline screen", async () => {
    const w = worker();
    const waitUntil = vi.fn();
    w.listeners.get("install")!({ waitUntil });
    await waitUntil.mock.calls[0]![0];
    expect(w.cache.add).toHaveBeenCalledOnce();
    expect(w.cache.add.mock.calls[0]![0]).toMatchObject({
      url: "/offline.html",
      options: { cache: "reload" },
    });
    expect(w.skipWaiting).not.toHaveBeenCalled();
  });
  it("deletes only obsolete owned caches without claiming active pages", async () => {
    const w = worker();
    const waitUntil = vi.fn();
    w.listeners.get("activate")!({ waitUntil });
    await waitUntil.mock.calls[0]![0];
    expect(w.caches.delete).toHaveBeenCalledExactlyOnceWith("brushy-offline-v0");
    expect(w.claim).not.toHaveBeenCalled();
  });
  it.each([
    "/",
    "/calendar",
    "/capture",
    "/friends",
    "/friends/11111111-1111-4111-8111-111111111111",
  ])("falls back for a failed app navigation to %s", async (path) => {
    const w = worker();
    const response = w.navigate(path);
    expect(await response.mock.calls[0]![0]).toEqual({
      body: w.fallback.body,
      options: {
        headers: w.fallback.headers,
        status: 503,
        statusText: "Service Unavailable",
      },
    });
    expect(w.cache.match).toHaveBeenCalledWith("/offline.html");
  });
  it.each([
    ["/api/check-in", {}],
    ["/_serverFn/id", {}],
    ["/auth/callback", {}],
    ["/?code=secret", {}],
    ["/?error=access_denied", {}],
    ["/assets/app.js", { mode: "cors" }],
    ["/", { mode: "cors" }],
    ["/", { method: "POST" }],
    ["/", { url: "https://photos.example/private.jpg" }],
    ["/unknown", {}],
  ])("passes through non-app or sensitive request %s %o", (path, overrides) => {
    const w = worker();
    expect(w.navigate(path, overrides)).not.toHaveBeenCalled();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.caches.open).not.toHaveBeenCalled();
  });
  it("never caches network pages or replaces server error responses with offline HTML", async () => {
    const w = worker();
    const serverError = { status: 500 };
    w.fetch.mockResolvedValue(serverError);
    const response = w.navigate();
    expect(await response.mock.calls[0]![0]).toBe(serverError);
    expect(w.caches.open).not.toHaveBeenCalled();
    expect(workerSource).not.toContain("cache.put");
  });
  it("returns a network error if the offline cache was evicted", async () => {
    const w = worker();
    w.cache.match.mockResolvedValue(undefined);
    const response = w.navigate();
    expect(await response.mock.calls[0]![0]).toEqual({ error: true });
  });
});
