import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { feedSchema, previewSchema, socialInputSchema, socialStateSchema } from "@/lib/social";

export const socialAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(socialInputSchema)
  .handler(async ({ data }) => {
    if (data.action === "photo") throw new Error("Use the protected photo endpoint.");
    const { socialRpc } = await import("./social-rpc.server");
    const result = await socialRpc(data, getRequest());
    switch (data.action) {
      case "state":
        return socialStateSchema.parse(result);
      case "feed":
        return feedSchema.parse(result);
      case "preview":
        return previewSchema.parse(result);
      case "reset_invite":
        return z.object({ token: z.string() }).parse(result);
      case "save":
        return z.object({ id: z.string().uuid(), revision: z.string().uuid() }).parse(result);
      default:
        return z.object({}).parse(result);
    }
  });
