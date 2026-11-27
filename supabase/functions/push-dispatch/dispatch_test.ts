// @ts-types="npm:@types/web-push@3.6.4"
import webPush from "npm:web-push@3.6.7";
import { deepEqual, equal, ok } from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { dispatchPush } from "./dispatch.ts";

Deno.test("authenticates the job, encrypts push, and removes an expired device", async () => {
  const keys = webPush.generateVAPIDKeys();
  const secrets = {
    PUSH_DISPATCH_TOKEN: "test-scheduler-token",
    SUPABASE_URL: "https://database.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-db-token",
    WEB_PUSH_SUBJECT: "mailto:push@example.test",
    WEB_PUSH_PUBLIC_KEY: keys.publicKey,
    WEB_PUSH_PRIVATE_KEY: keys.privateKey,
  };
  const original = Object.entries(secrets).map(([name, value]) => {
    const saved = Deno.env.get(name);
    Deno.env.set(name, value);
    return [name, saved] as const;
  });
  const client = createECDH("prime256v1");
  client.generateKeys();
  const endpoint = "https://fcm.googleapis.com/fcm/send/testing";
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("_work")) {
      return Response.json([{ event_id: "event", device_id: "device" }]);
    }
    if (url.endsWith("_take")) {
      deepEqual(JSON.parse(String(init?.body)), { p_event: "event", p_device: "device" });
      return Response.json({
        endpoint,
        p256dh: client.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
        kind: "heart",
        target: "test-selfie",
        revision: "test-revision",
        expires_at: new Date(Date.now() + 120_000),
      });
    }
    if (url === endpoint) {
      const request = new Request(url, init);
      equal(init?.redirect, "error");
      equal(request.headers.get("content-encoding"), "aes128gcm");
      ok(request.headers.get("authorization")?.startsWith("vapid "));
      ok(Number(request.headers.get("ttl")) <= 120);
      ok(
        !(await request.text()).includes("test-selfie"),
        "provider must receive encrypted payload",
      );
      return new Response(null, { status: 410 });
    }
    ok(url.endsWith("_drop"));
    deepEqual(JSON.parse(String(init?.body)), { p_device: "device" });
    return Response.json(null);
  };
  try {
    const invoke = (token: string) =>
      dispatchPush(
        new Request("https://edge.example", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        }),
      );
    equal((await invoke("invalid")).status, 401);
    equal(calls.length, 0);
    const result = await invoke(secrets.PUSH_DISPATCH_TOKEN);
    equal(result.status, 200);
    deepEqual(await result.json(), { sent: 0, failed: 0, expired: 1 });
    deepEqual(calls, [
      "https://database.example/rest/v1/rpc/brushy_push_work",
      "https://database.example/rest/v1/rpc/brushy_push_take",
      endpoint,
      "https://database.example/rest/v1/rpc/brushy_push_drop",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of original) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
