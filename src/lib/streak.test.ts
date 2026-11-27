import { describe, it, expect } from "vitest";
import { brushingSlot, computeStreak } from "./streak";

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
  it.each([
    ["2026-01-01T04:59:59-08:00", "2025-12-31", "pm"],
    ["2026-01-01T05:00:00-08:00", "2026-01-01", "am"],
    ["2026-01-01T13:59:59-08:00", "2026-01-01", "am"],
    ["2026-01-01T14:00:00-08:00", "2026-01-01", "pm"],
    ["2026-03-08T05:00:00-07:00", "2026-03-08", "am"],
  ])(
    "assigns %s using the account time zone and brushing-day boundary",
    (instant, local_date, slot) => {
      expect(brushingSlot(new Date(instant), "America/Los_Angeles")).toEqual({ local_date, slot });
    },
  );
});
