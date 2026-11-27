import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Camera, Flame } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SelfieDialog } from "@/components/SelfieDialog";
import { useAuth } from "@/hooks/useAuth";
import { useBrushings, type Brushing } from "@/hooks/useBrushings";
import { computeStreak, type Slot } from "@/lib/streak";
import { useBrushingClock } from "@/hooks/useCheckInTiming";
import { FriendsFeed } from "@/components/FriendsFeed";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Brushy — Today's Brushing Streak" },
      {
        name: "description",
        content:
          "Check in morning and night with a live brushing selfie and keep your streak going.",
      },
      { property: "og:title", content: "Brushy — Today's Brushing Streak" },
      {
        property: "og:description",
        content:
          "Check in morning and night with a live brushing selfie and keep your streak going.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <AppShell>
      <Today />
    </AppShell>
  ),
});

function Today() {
  const { user } = useAuth();
  const { items, reload } = useBrushings(user?.id);
  const [open, setOpen] = useState<Brushing | null>(null);
  const onDeleted = () => {
    setOpen(null);
    void reload();
  };
  const clock = useBrushingClock();
  const today = clock.current?.local_date;
  const current = clock.current?.slot;
  const get = (s: Slot) => items.find((i) => i.local_date === today && i.slot === s);
  const done = current && !!get(current);

  return (
    <div className="space-y-6">
      {!today || !current ? (
        clock.timing.isError ? (
          <p role="alert">
            Could not load check-in timing.{" "}
            <button className="underline" onClick={() => void clock.timing.refetch()}>
              Retry
            </button>
          </p>
        ) : (
          <p role="status">Loading check-in timing…</p>
        )
      ) : (
        <>
          <section className="flex items-center gap-4 rounded-[var(--radius)] bg-card p-5 shadow-soft">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-flame/15">
              <Flame className="h-9 w-9 text-flame" fill="currentColor" />
            </div>
            <div>
              <div className="font-display text-4xl font-extrabold leading-none">
                {computeStreak(items, today)}
              </div>
              <div className="text-sm text-muted-foreground">day streak · both AM & PM</div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            {(["am", "pm"] as Slot[]).map((s) => {
              const b = get(s);
              return (
                <button
                  key={s}
                  disabled={!b}
                  onClick={() => b && setOpen(b)}
                  className="relative aspect-[3/4] overflow-hidden rounded-[var(--radius)] border-2 border-dashed border-border bg-card text-left disabled:cursor-default"
                >
                  {b?.url ? (
                    <img
                      src={b.url}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-5xl opacity-30">
                      {s === "am" ? "☀️" : "🌙"}
                    </div>
                  )}
                  <span className="absolute left-3 top-3 rounded-full bg-card/90 px-2.5 py-1 text-xs font-bold">
                    {s === "am" ? "Morning" : "Evening"} {b ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </section>

          {done ? (
            <div className="space-y-3">
              <p className="rounded-[var(--radius)] bg-secondary p-4 text-center font-medium">
                {current === "am"
                  ? "Morning done! See you tonight 🌙"
                  : "All done for today. Sweet dreams ✨"}
              </p>
              <Link to="/capture" className="block text-center text-sm underline">
                Retake {current === "am" ? "morning" : "evening"} selfie
              </Link>
            </div>
          ) : (
            <Link
              to="/capture"
              className="flex w-full items-center justify-center gap-2 rounded-full bg-fresh py-4 font-display text-lg font-bold text-primary-foreground shadow-soft transition-transform active:scale-95"
            >
              <Camera className="h-6 w-6" /> Brush & snap {current === "am" ? "morning" : "evening"}{" "}
              selfie
            </Link>
          )}
        </>
      )}
      <FriendsFeed onDeleted={onDeleted} />
      <SelfieDialog item={open} onClose={() => setOpen(null)} onDeleted={onDeleted} />
    </div>
  );
}
