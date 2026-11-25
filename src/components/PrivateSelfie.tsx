import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function PrivateSelfie({
  id,
  revision,
  alt,
  viewerId,
}: {
  id: string;
  revision: string;
  alt: string;
  viewerId: string;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState(false);
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry?.isIntersecting ?? false);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setUrl(undefined);
    setError(undefined);
    async function load() {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user.id !== viewerId)
          throw new Error("Sign in again to view this selfie.");
        const response = await fetch(
          `/api/selfies/${encodeURIComponent(id)}?revision=${encodeURIComponent(revision)}`,
          {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "This selfie is no longer shared with you."
              : "Could not load this selfie. Try again.",
          );
        if (!response.headers.get("content-type")?.startsWith("image/jpeg"))
          throw new Error("The selfie response was invalid. Try again.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Could not load a feed selfie", error);
        setError(error instanceof Error ? error.message : "Could not load this selfie.");
      }
    }
    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, revision, viewerId, retry, visible]);

  return (
    <div
      ref={element}
      className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl bg-muted"
    >
      {url && visible ? (
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : error ? (
        <div className="space-y-3 p-6 text-center">
          <p role="status" className="text-sm">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
            Retry photo
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{visible ? "Loading selfie…" : "Selfie"}</p>
      )}
    </div>
  );
}
