import { describe, it, expect } from "vitest";
import { computeStreak, slotFor } from "./streak";

describe("streak", () => {
  it("counts only days with both AM and PM", () => {
    const rows = [
      { local_date: "2026-11-15", slot: "am" as const },
      { local_date: "2026-11-15", slot: "pm" as const },
      { local_date: "2026-11-16", slot: "am" as const },
    ];
    expect(computeStreak(rows, "2026-11-16")).toBe(1);
  });
  it("includes today when complete and chains back", () => {
    const rows = ["14", "15", "16"].flatMap((d) => [
      { local_date: `2026-11-${d}`, slot: "am" as const },
      { local_date: `2026-11-${d}`, slot: "pm" as const },
    ]);
    expect(computeStreak(rows, "2026-11-16")).toBe(3);
  });
  it("breaks on a missed day", () => {
    const rows = [
      { local_date: "2026-11-13", slot: "am" as const },
      { local_date: "2026-11-13", slot: "pm" as const },
    ];
    expect(computeStreak(rows, "2026-11-16")).toBe(0);
  });
  it("morning slot ends at 3pm", () => {
    expect(slotFor(new Date(2026, 0, 1, 14, 59))).toBe("am");
    expect(slotFor(new Date(2026, 0, 1, 15, 0))).toBe("pm");
  });
});
