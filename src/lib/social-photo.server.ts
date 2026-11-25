import { z } from "zod";
import { socialInputSchema } from "@/lib/social";
import { SocialError, socialRpc } from "@/lib/social-rpc.server";
import { isOwnedLegacyPhotoPath, s3PhotoKey } from "@/lib/selfie-path";
import { readSelfie } from "@/lib/selfie-storage.server";

const permissionSchema = z.object({ photo_path: z.string(), owner_id: z.string().uuid() });
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};

async function readLegacyPhoto(request: Request, path: string, ownerId: string) {
  const segments = path.split("/");
  if (!isOwnedLegacyPhotoPath(path, ownerId)) {
    throw new SocialError("This photo is unavailable.", 404);
  }
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const authorization = request.headers.get("authorization");
  if (!url || !key || !authorization) throw new SocialError("Photo storage is unavailable.", 503);
  const response = await fetch(
    `${url.replace(/\/$/, "")}/storage/v1/object/authenticated/selfies/${segments.map(encodeURIComponent).join("/")}`,
    {
      headers: { authorization, apikey: key },
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    },
  );
  if (!response.ok || !response.body) {
    throw new SocialError("This photo is unavailable.", response.status === 401 ? 401 : 404);
  }
  return response.body;
}

export async function serveSocialPhoto(request: Request, id: string): Promise<Response> {
  try {
    const input = socialInputSchema.parse({
      action: "photo",
      data: { id, revision: new URL(request.url).searchParams.get("revision") },
    });
    const permission = permissionSchema.parse(await socialRpc(input, request));
    const key = s3PhotoKey(permission.photo_path, permission.owner_id);
    const photo = key
      ? await readSelfie(key, request.signal)
      : await readLegacyPhoto(request, permission.photo_path, permission.owner_id);
    return new Response(photo, { headers: { ...headers, "Content-Type": "image/jpeg" } });
  } catch (error) {
    if (error instanceof z.ZodError)
      return new Response("Invalid photo request.", { status: 400, headers });
    if (error instanceof SocialError) {
      return new Response(
        error.status === 400 ? "This photo is no longer available to you." : error.message,
        {
          status: error.status === 400 ? 404 : error.status,
          headers,
        },
      );
    }
    console.error("Could not serve a shared selfie", error);
    return new Response("Could not load this selfie. Try again.", { status: 503, headers });
  }
}
