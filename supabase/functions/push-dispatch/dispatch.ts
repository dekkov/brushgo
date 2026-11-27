// @ts-types="npm:@types/web-push@3.6.4"
import webPush from "npm:web-push@3.6.7";
import { createHash, timingSafeEqual } from "node:crypto";

type Work = { event_id: string; device_id: string };
type Delivery = {
  endpoint: string;
  p256dh: string;
  auth: string;
  kind: "reminder" | "request" | "heart";
  target: string | null;
  revision: string | null;
  expires_at: string;
};

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function authorized(header: string, token: string) {
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(header), hash(`Bearer ${token}`));
}

function validateEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^(?:fcm\.googleapis\.com|(?:web|[a-z0-9-]+)\.push\.apple\.com|updates\.push\.services\.mozilla\.com)$/.test(
      url.hostname,
    )
  )
    throw new Error("Unapproved Web Push provider");
}

export async function dispatchPush(request: Request) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  try {
    if (!authorized(request.headers.get("authorization") ?? "", required("PUSH_DISPATCH_TOKEN"))) {
      return new Response(null, { status: 401 });
    }
    const url = required("SUPABASE_URL");
    const key = required("SUPABASE_SERVICE_ROLE_KEY");
    const vapidDetails = {
      subject: required("WEB_PUSH_SUBJECT"),
      publicKey: required("WEB_PUSH_PUBLIC_KEY"),
      privateKey: required("WEB_PUSH_PRIVATE_KEY"),
    };
    async function rpc<T>(action: string, data: Record<string, string> = {}): Promise<T> {
      const response = await fetch(`${url}/rest/v1/rpc/brushy_push_${action}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          apikey: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Push database ${action} failed (${response.status})`);
      return response.json();
    }
    const work = await rpc<Work[]>("work");
    const deadline = Date.now() + 30_000;
    let sent = 0,
      failed = 0,
      expired = 0;
    // Keep outbound work bounded; other invocations can safely race for unclaimed deliveries.
    for (let i = 0; i < work.length; i += 10) {
      if (Date.now() >= deadline) break;
      await Promise.all(
        work.slice(i, i + 10).map(async ({ event_id, device_id }) => {
          try {
            const delivery = await rpc<Delivery | null>("take", {
              p_event: event_id,
              p_device: device_id,
            });
            if (!delivery) return;
            validateEndpoint(delivery.endpoint);
            const ttl = Math.floor((Date.parse(delivery.expires_at) - Date.now()) / 1000);
            if (!Number.isFinite(ttl) || ttl <= 0) return;
            const details = webPush.generateRequestDetails(
              {
                endpoint: delivery.endpoint,
                keys: { p256dh: delivery.p256dh, auth: delivery.auth },
              },
              JSON.stringify({
                kind: delivery.kind,
                target: delivery.target,
                revision: delivery.revision,
              }),
              { TTL: ttl, vapidDetails },
            );
            const headers = new Headers();
            for (const [name, value] of Object.entries(details.headers))
              headers.set(name, String(value));
            const response = await fetch(details.endpoint, {
              method: "POST",
              headers,
              body: details.body ? new Uint8Array(details.body) : null,
              redirect: "error",
              signal: AbortSignal.timeout(5000),
            });
            await response.body?.cancel();
            if (response.status === 404 || response.status === 410) {
              await rpc("drop", { p_device: device_id });
              expired++;
            } else if (response.ok) {
              sent++;
            } else {
              failed++;
              console.error("Web Push provider rejected a notification", {
                status: response.status,
              });
            }
          } catch {
            failed++;
            console.error("Could not dispatch a Web Push notification");
          }
        }),
      );
    }
    return Response.json({ sent, failed, expired }, { status: failed ? 502 : 200 });
  } catch {
    console.error(
      "Web Push dispatch could not run; check Edge Function configuration and RPC grants",
    );
    return new Response(null, { status: 503 });
  }
}
