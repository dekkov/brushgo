export type Slot = "am" | "pm";
export interface BrushRow { local_date: string; slot: Slot }

export function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Morning slot runs until 3pm local time; evening after. */
export function slotFor(d: Date): Slot {
  return d.getHours() < 15 ? "am" : "pm";
}

function addDays(dateStr: string, n: number): string {
  const [y = 0, m = 1, d = 1] = dateStr.split("-").map(Number);
  return toLocalDate(new Date(y, m - 1, d + n));
}

/** A day counts once both AM and PM are logged. Streak ends today, or yesterday if today isn't done yet. */
export function computeStreak(rows: BrushRow[], today: string): number {
  const byDay = new Map<string, Set<Slot>>();
  for (const r of rows) {
    if (!byDay.has(r.local_date)) byDay.set(r.local_date, new Set());
    byDay.get(r.local_date)!.add(r.slot);
  }
  const complete = (d: string) => byDay.get(d)?.size === 2;
  let cursor = complete(today) ? today : addDays(today, -1);
  let streak = 0;
  while (complete(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
