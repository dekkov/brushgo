import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isOwnedLegacyPhotoPath, s3PhotoKey } from "@/lib/selfie-path";
import { deleteSelfieObject } from "@/lib/selfie-storage.server";

export async function deleteOwnedSelfie(
  supabase: SupabaseClient<Database>,
  userId: string,
  id: string,
  revision: string,
): Promise<void> {
  const { data: photo, error } = await supabase
    .from("brushings")
    .select("id, photo_path")
    .eq("user_id", userId)
    .eq("id", id)
    .filter("revision", "eq", revision)
    .maybeSingle();
  if (error) {
    console.error("Could not load selfie for deletion", error.message);
    throw new Error("Could not load this selfie. Try again.");
  }
  if (!photo) throw new Error("This selfie was deleted or replaced. Refresh and try again.");

  try {
    const key = s3PhotoKey(photo.photo_path, userId);
    if (key) {
      await deleteSelfieObject(key);
    } else {
      if (!isOwnedLegacyPhotoPath(photo.photo_path, userId))
        throw new Error("Invalid owned legacy photo path");
      const { error: storageError } = await supabase.storage
        .from("selfies")
        .remove([photo.photo_path]);
      if (storageError) throw storageError;
    }
  } catch (error) {
    console.error(
      "Could not delete stored selfie",
      error instanceof Error ? error.message : "Unknown storage error",
    );
    throw new Error(
      "Could not delete the stored image. Check storage delete permissions and try again.",
    );
  }

  // Keep the row until storage deletion succeeds, so a failed deletion can be retried.
  const { data: deleted, error: deleteError } = await supabase
    .from("brushings")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .filter("revision", "eq", revision)
    .select("id");
  if (deleteError) {
    console.error("Could not remove deleted selfie's check-in", deleteError.message);
    throw new Error(
      "The stored image was deleted, but its check-in could not be removed. Retry deleting to finish.",
    );
  }
  if (!deleted?.length)
    throw new Error("This selfie changed or was already deleted. Refresh and try again.");
}
