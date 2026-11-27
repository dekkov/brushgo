import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { currentTimeZone, timingSchema } from "@/lib/social";
import { socialAction } from "@/lib/social.functions";
import { brushingSlot } from "@/lib/streak";

export function useCheckInTiming() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["check-in-timing", user?.id],
    enabled: !!user,
    gcTime: 0,
    queryFn: async () =>
      timingSchema.parse(
        await socialAction({
          data: { action: "timing", data: { time_zone: currentTimeZone() } },
        }),
      ),
  });
}

export function useBrushingClock() {
  const timing = useCheckInTiming();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const settings = timing.data;
  function at(clientTime = Date.now()) {
    if (!settings) return;
    const instant = new Date(
      Date.parse(settings.server_now) + Math.max(0, clientTime - timing.dataUpdatedAt),
    );
    const zone =
      settings.next_time_zone && settings.changes_at && instant >= new Date(settings.changes_at)
        ? settings.next_time_zone
        : settings.time_zone;
    return { ...brushingSlot(instant, zone), timeZone: zone };
  }
  return { timing, current: at(now), at };
}
