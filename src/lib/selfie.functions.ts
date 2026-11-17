import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { s3PhotoKey, s3PhotoPath } from "@/lib/selfie-path";

export const createSelfieUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = `${context.userId}/${crypto.randomUUID()}.jpg`;
    const { signSelfieUpload } = await import("./selfie-storage.server");
    return { path: s3PhotoPath(key), url: await signSelfieUpload(key) };
  });

export const getSelfieUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ ids: z.array(z.string().uuid()).max(1000) }))
  .handler(async ({ context, data }) => {
    if (!data.ids.length) return [];
    const batches = Array.from({ length: Math.ceil(data.ids.length / 100) }, (_, index) =>
      data.ids.slice(index * 100, (index + 1) * 100),
    );
    const results = await Promise.all(
      batches.map((ids) =>
        context.supabase
          .from("brushings")
          .select("id, photo_path")
          .eq("user_id", context.userId)
          .in("id", ids),
      ),
    );
    if (results.some((result) => result.error)) throw new Error("Could not load selfie records");
    const rows = results.flatMap((result) => result.data ?? []);
    const photos = rows.flatMap((row) => {
      const key = s3PhotoKey(row.photo_path, context.userId);
      return key ? [{ id: row.id, key }] : [];
    });
    if (!photos.length) return [];
    const { signSelfieReads } = await import("./selfie-storage.server");
    const urls = await signSelfieReads(photos.map((photo) => photo.key));
    return photos.map((photo, i) => ({ id: photo.id, url: urls[i]! }));
  });
