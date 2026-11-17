import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { detect, isVerified, loadDetector, type Detection } from "@/lib/detector";
import { createSelfieUpload } from "@/lib/selfie.functions";
import { slotFor, toLocalDate } from "@/lib/streak";

export const Route = createFileRoute("/capture")({
  head: () => ({
    meta: [
      { title: "Snap a Brushing Selfie — Brushy" },
      { name: "description", content: "Take a live selfie while brushing to log your check-in." },
      { property: "og:title", content: "Snap a Brushing Selfie — Brushy" },
      { property: "og:description", content: "Take a live selfie while brushing to log your check-in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <Capture />
    </AppShell>
  ),
});

function Capture() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [camError, setCamError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [live, setLive] = useState<Detection | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string; det: Detection } | null>(null);
  const [saving, setSaving] = useState(false);

  // Camera stream
  useEffect(() => {
    if (shot) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setCamError(null);
      })
      .catch(() => setCamError("We need camera access to take your brushing selfie."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [facing, shot]);

  // Model + live feedback loop
  useEffect(() => {
    let stop = false;
    loadDetector().then(() => setModelReady(true)).catch(() => {});
    const tick = async () => {
      if (stop) return;
      const v = videoRef.current;
      if (modelReady && v && v.readyState >= 2 && !shot) {
        try { setLive(await detect(v)); } catch { /* ignore */ }
      }
      setTimeout(tick, 800);
    };
    tick();
    return () => { stop = true; };
  }, [modelReady, shot]);

  function startCountdown() {
    let n = 3;
    setCountdown(n);
    const id = setInterval(() => {
      n--;
      if (n === 0) { clearInterval(id); setCountdown(null); snap(); }
      else setCountdown(n);
    }, 1000);
  }

  async function snap() {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    if (facing === "user") { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let det: Detection = { person: 0, toothbrush: 0 };
    try { det = await detect(c); } catch { /* model unavailable */ }
    c.toBlob((blob) => { if (blob) setShot({ blob, url: URL.createObjectURL(blob), det }); }, "image/jpeg", 0.85);
  }

  async function save() {
    if (!shot || !user) return;
    setSaving(true);
    const now = new Date();
    const local_date = toLocalDate(now);
    const slot = slotFor(now);
    try {
      const { path, url } = await createSelfieUpload();
      const upload = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: shot.blob,
      });
      if (!upload.ok) throw new Error("Could not upload your selfie. Please try again.");
      const verified = isVerified(shot.det);
      const { error } = await supabase.from("brushings").upsert(
        { user_id: user.id, local_date, slot, photo_path: path, verified, confidence: shot.det.toothbrush },
        { onConflict: "user_id,local_date,slot" },
      );
      if (error) throw error;
      toast.success(verified ? "Verified brushing logged ✨" : "Check-in logged!");
      navigate({ to: "/" });
    } catch (error) {
      console.error("Could not save brushing", error);
      toast.error("Could not save your check-in. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const hasBrush = (live?.toothbrush ?? 0) >= 0.35;
  const hasFace = (live?.person ?? 0) >= 0.5;

  return (
    <div className="space-y-4">
      <div className="relative aspect-[3/4] overflow-hidden rounded-[var(--radius)] bg-foreground shadow-soft">
        {shot ? (
          <img src={shot.url} alt="Your selfie" className="h-full w-full object-cover" />
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`} />
        )}
        {camError && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-background">{camError}</div>}
        {countdown && (
          <div className="absolute inset-0 flex items-center justify-center font-display text-9xl font-extrabold text-background drop-shadow-lg">{countdown}</div>
        )}
        {!shot && (
          <div className="absolute left-3 right-3 top-3 flex flex-wrap gap-2">
            <Pill ok={hasFace} label={modelReady ? "Face" : "Loading detector…"} />
            {modelReady && <Pill ok={hasBrush} label="Toothbrush" />}
          </div>
        )}
        {!shot && (
          <button onClick={() => setFacing(facing === "user" ? "environment" : "user")} className="absolute bottom-3 right-3 rounded-full bg-card/80 p-3" aria-label="Flip camera">
            <RefreshCw className="h-5 w-5" />
          </button>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      {!shot ? (
        <button
          onClick={startCountdown}
          disabled={!!camError || countdown !== null}
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-primary bg-card shadow-soft transition-transform active:scale-90 disabled:opacity-40"
          aria-label="Take selfie"
        >
          <span className="h-14 w-14 rounded-full bg-fresh" />
        </button>
      ) : isVerified(shot.det) ? (
        <div className="space-y-3">
          <p className="flex items-center justify-center gap-2 font-semibold text-primary"><Sparkles className="h-5 w-5" /> Brushing detected!</p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShot(null)}><X className="h-4 w-4" />Retake</Button>
            <Button className="flex-1" disabled={saving} onClick={save}>Log it</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            {shot.det.person < 0.5 ? "We couldn't spot your face clearly." : "Make sure your brush is in view."} Try again, or log it anyway.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setShot(null)}><RefreshCw className="h-4 w-4" />Retake</Button>
            <Button variant="outline" className="flex-1" disabled={saving} onClick={save}>Confirm & log anyway</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold backdrop-blur ${ok ? "bg-primary text-primary-foreground" : "bg-card/80 text-foreground"}`}>
      {ok ? "✓ " : "○ "}{label}
    </span>
  );
}
