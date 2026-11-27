import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const kind = z.enum(["reminder", "request", "heart"]);
const endpoint = z.string().url().max(2048);
const pushStatus = z.object({ attached: z.boolean(), enabled: z.array(kind) });
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), data: z.object({ endpoint: endpoint.optional() }) }),
  z.object({ action: z.literal("detach"), data: z.object({ endpoint }) }),
  z.object({
    action: z.literal("attach"),
    data: z.object({ endpoint, p256dh: z.string().length(87), auth: z.string().length(22) }),
    userId: z.string().uuid(),
  }),
  z.object({ action: z.literal("set_preference"), data: z.object({ kind, enabled: z.boolean() }) }),
]);
export type PushKind = z.infer<typeof kind>;

export const pushAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(input)
  .handler(async ({ data, context }) => {
    if (data.action === "attach" && data.userId !== context.userId) {
      throw new Error("The signed-in account changed. Enable notifications again.");
    }
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    const authorization = getRequest().headers.get("authorization");
    if (!url || !key || !authorization) throw new Error("Notifications are unavailable.");
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/brushy_push`, {
      method: "POST",
      headers: { authorization, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ p_action: data.action, p_data: data.data }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error("Notification settings request failed", {
        action: data.action,
        status: response.status,
      });
      throw new Error("Could not update notifications. Try again or check deployment setup.");
    }
    return pushStatus.parse(await response.json());
  });
