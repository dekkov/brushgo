import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SelfieDialog } from "@/components/SelfieDialog";
import { useAuth } from "@/hooks/useAuth";
import { useBrushings, type Brushing } from "@/hooks/useBrushings";
import { toLocalDate } from "@/lib/streak";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Your Brushing Memories — Brushy" },
      { name: "description", content: "Look back at every morning and evening brushing selfie in a monthly calendar." },
      { property: "og:title", content: "Your Brushing Memories — Brushy" },
      { property: "og:description", content: "Look back at every morning and evening brushing selfie in a monthly calendar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <CalendarView />
    </AppShell>
  ),
});

function CalendarView() {
  const { user } = useAuth();
  const { items, reload } = useBrushings(user?.id);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState<Brushing | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, { am?: Brushing; pm?: Brushing }>();
    for (const i of items) { const e = m.get(i.local_date) ?? {}; e[i.slot] = i; m.set(i.local_date, e); }
    return m;
  }, [items]);

  const first = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = toLocalDate(new Date());
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => toLocalDate(new Date(month.getFullYear(), month.getMonth(), i + 1)))];
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const sel = day ? byDay.get(day) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={() => shift(-1)} className="rounded-full p-2 hover:bg-secondary" aria-label="Previous month"><ChevronLeft /></button>
        <h1 className="font-display text-2xl font-bold">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h1>
        <button onClick={() => shift(1)} className="rounded-full p-2 hover:bg-secondary" aria-label="Next month"><ChevronRight /></button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-muted-foreground">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const e = byDay.get(c);
          const cover = e?.pm ?? e?.am;
          const full = !!(e?.am && e?.pm);
          return (
            <button
              key={c}
              disabled={!e}
              onClick={() => setDay(c)}
              className={`relative aspect-[3/4] overflow-hidden rounded-xl bg-card ${full ? "ring-2 ring-flame" : ""} ${c === today ? "outline outline-2 outline-primary" : ""} ${day === c ? "scale-95" : ""} transition-transform`}
            >
              {cover?.url && <img src={cover.url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              <span className={`absolute inset-x-0 bottom-0.5 text-[11px] font-bold ${cover ? "text-background drop-shadow" : "text-foreground"}`}>{Number(c.slice(8))}</span>
            </button>
          );
        })}
      </div>

      {day && (
        <section className="rounded-[var(--radius)] bg-card p-4 shadow-soft">
          <h2 className="mb-3 font-display font-bold">{new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>
          <div className="grid grid-cols-2 gap-3">
            {(["am", "pm"] as const).map((s) => {
              const b = sel?.[s];
              return (
                <button key={s} disabled={!b} onClick={() => b && setOpen(b)} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">
                  {b?.url ? <img src={b.url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Missed</div>}
                  <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-0.5 text-xs font-bold">{s === "am" ? "☀️ AM" : "🌙 PM"}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <SelfieDialog item={open} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); void reload(); }} />
    </div>
  );
}
