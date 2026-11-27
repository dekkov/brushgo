import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { NotificationSettings } from "@/components/NotificationSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useBrushingClock } from "@/hooks/useCheckInTiming";
import { currentTimeZone, timingSchema } from "@/lib/social";
import { socialAction } from "@/lib/social.functions";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Brushy" }] }),
  component: () => (
    <AppShell>
      <Settings />
    </AppShell>
  ),
});

function Settings() {
  const { user } = useAuth();
  const { current, timing } = useBrushingClock();
  const client = useQueryClient();
  const [zone, setZone] = useState<string>();
  const mutation = useMutation({
    mutationFn: async (time_zone: string) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: time_zone });
      } catch {
        throw new Error("Enter a valid time zone, such as America/Los_Angeles.");
      }
      return timingSchema.parse(
        await socialAction({
          data: { action: "schedule_time_zone", data: { time_zone } },
        }),
      );
    },
    onSuccess: (settings) => {
      client.setQueryData(["check-in-timing", user?.id], settings);
      setZone(undefined);
    },
  });
  const settings = timing.data;
  const activeZone = current?.timeZone;
  const pendingZone = settings?.next_time_zone !== activeZone ? settings?.next_time_zone : null;
  const selectedZone = zone ?? pendingZone ?? activeZone ?? "";
  return (
    <section className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Settings</h1>
      <h2 className="font-display text-xl font-bold">Check-in time zone</h2>
      <p>Morning: 5 AM to 2 PM. Evening: 2 PM to 5 AM the next day.</p>
      {timing.isError && (
        <p role="alert">
          Could not load check-in timing.{" "}
          <button className="underline" onClick={() => void timing.refetch()}>
            Retry
          </button>
        </p>
      )}
      {timing.isPending && <p role="status">Loading check-in timing…</p>}
      {settings && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(selectedZone.trim());
          }}
        >
          <p>Current time zone: {activeZone}</p>
          {pendingZone && settings.changes_at && (
            <p role="status">
              Changing to {pendingZone} at 5 AM on{" "}
              {new Date(settings.changes_at).toLocaleDateString(undefined, {
                timeZone: settings.time_zone,
              })}{" "}
              in {settings.time_zone}.
            </p>
          )}
          <NotificationSettings key={user?.id} />
          <label htmlFor="check-in-time-zone">Account time zone</label>
          <Input
            id="check-in-time-zone"
            value={selectedZone}
            maxLength={80}
            list="check-in-time-zones"
            onChange={(event) => setZone(event.target.value)}
            required
          />
          <datalist id="check-in-time-zones">
            {Intl.supportedValuesOf?.("timeZone").map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setZone(currentTimeZone())}>
              Use device time zone
            </Button>
            <Button disabled={mutation.isPending || !selectedZone.trim()}>Save time zone</Button>
          </div>
          {mutation.isError && <p role="alert">{mutation.error.message}</p>}
          {mutation.isSuccess && <p role="status">Time zone preference saved.</p>}
        </form>
      )}
    </section>
  );
}
