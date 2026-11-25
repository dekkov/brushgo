import { z } from "zod";
import type { SocialInput } from "@/lib/social";

const rpcErrorSchema = z.object({ message: z.string(), code: z.string().optional() });

export class SocialError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export async function socialRpc(input: SocialInput, request: Request): Promise<unknown> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length < 10) {
    throw new SocialError("Sign in to continue.", 401);
  }
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new SocialError("Supabase is not configured.", 503);
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/brushy_social`, {
    method: "POST",
    headers: { authorization, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_action: input.action, p_data: input.data }),
    cache: "no-store",
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = rpcErrorSchema.safeParse(body);
    if (error.success && ["PGRST202", "42P01", "42883"].includes(error.data.code ?? "")) {
      throw new SocialError(
        "Friends is not set up yet. Apply the Friends SQL before using this feature.",
        503,
      );
    }
    if (response.status === 401)
      throw new SocialError("Your session expired. Please sign in again.", 401);
    // Database exceptions are deliberately written as user-facing messages.
    if (error.success && error.data.code === "P0001") throw new SocialError(error.data.message);
    console.error("Friends database request failed", {
      action: input.action,
      status: response.status,
      code: error.success ? error.data.code : undefined,
    });
    throw new SocialError("Could not complete the Friends request. Please try again.", 503);
  }
  return body;
}
