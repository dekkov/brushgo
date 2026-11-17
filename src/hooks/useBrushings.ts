import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Slot } from "@/lib/streak";
import { getSelfieUrls } from "@/lib/selfie.functions";
import { toast } from "sonner";

export interface Brushing {
  id: string;
  local_date: string;
  slot: Slot;
  photo_path: string;
  verified: boolean;
  confidence: number | null;
  created_at: string;
  url?: string | undefined;
}

export function useBrushings(userId: string | undefined) {
  const [items, setItems] = useState<Brushing[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("brushings")
      .select("*")
      .eq("user_id", userId)
      .order("local_date", { ascending: false })
      .limit(1000);
    if (error) {
      console.error("Could not load brushings", error);
      toast.error("Could not load your check-ins.");
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as Brushing[];
    if (rows.length) {
      const legacy = rows.filter((row) => !row.photo_path.startsWith("s3:"));
      const s3 = rows.filter((row) => row.photo_path.startsWith("s3:"));
      if (legacy.length) {
        try {
          const { data: signed, error: signedError } = await supabase.storage
            .from("selfies")
            .createSignedUrls(
              legacy.map((r) => r.photo_path),
              3600,
            );
          if (signedError) throw signedError;
          signed.forEach((s, i) => {
            const row = legacy[i];
            if (s.error) throw new Error(s.error);
            if (row) row.url = s.signedUrl ?? undefined;
          });
        } catch (error) {
          console.error("Could not load legacy selfie URLs", error);
          toast.error("Some older selfies could not be loaded.");
        }
      }
      if (s3.length) {
        try {
          const signed = await getSelfieUrls({ data: { ids: s3.map((row) => row.id) } });
          const urls = new Map(signed.map((photo) => [photo.id, photo.url]));
          s3.forEach((row) => {
            row.url = urls.get(row.id);
          });
          if (signed.length !== s3.length) throw new Error("Missing signed selfie URLs");
        } catch (error) {
          console.error("Could not load S3 selfie URLs", error);
          toast.error("Some selfies could not be loaded.");
        }
      }
    }
    setItems(rows);
    setLoading(false);
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);
  return { items, loading, reload: load };
}
