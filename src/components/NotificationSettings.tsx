import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  deviceSubscription,
  disableDeviceNotifications,
  enableDeviceNotifications,
  pushConfigured,
  supportsPush,
} from "@/lib/push-device";
import { type PushKind, pushAction } from "@/lib/push.functions";

const choices: [PushKind, string][] = [
  ["reminder", "Brushing reminders at 10 AM and 9 PM"],
  ["request", "Incoming friend requests"],
  ["heart", "Hearts on my selfies"],
];

export function NotificationSettings() {
  const { user, loading } = useAuth();
  const client = useQueryClient();
  const queryKey = ["push-settings", user?.id];
  const settings = useQuery({
    queryKey,
    enabled: pushConfigured && !loading && !!user,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const subscription = await deviceSubscription();
      return pushAction({
        data: { action: "status", data: subscription ? { endpoint: subscription.endpoint } : {} },
      });
    },
  });
  const preference = useMutation({
    mutationFn: ({ kind, enabled }: { kind: PushKind; enabled: boolean }) =>
      pushAction({ data: { action: "set_preference", data: { kind, enabled } } }),
    onSuccess: (result) => {
      client.setQueryData(queryKey, { ...result, attached: settings.data?.attached ?? false });
    },
  });
  const device = useMutation({
    mutationFn: async (permission?: Promise<NotificationPermission>) => {
      if (permission && user) await enableDeviceNotifications(user.id, await permission);
      else if (!permission) await disableDeviceNotifications();
    },
    onSettled: () => void client.invalidateQueries({ queryKey }),
  });
  const canEnable = supportsPush() && Notification.permission !== "denied";
  const busy = preference.isPending || device.isPending;
  return (
    <section className="space-y-3 border-t pt-4" aria-label="Notifications">
      <h2 className="font-display text-xl font-bold">Notifications</h2>
      <p className="text-sm text-muted-foreground">
        Choose what to receive across your account. Enable each device separately. Notifications
        never include names or photos.
      </p>
      {!pushConfigured ? (
        <p>Push notifications aren’t set up yet.</p>
      ) : settings.isError ? (
        <p role="alert">
          Could not load notifications.{" "}
          <button className="underline" onClick={() => void settings.refetch()}>
            Retry
          </button>
        </p>
      ) : !settings.data ? (
        <p role="status">Loading notification settings…</p>
      ) : (
        <>
          <fieldset className="space-y-2" disabled={busy}>
            <legend className="font-medium">Account preferences</legend>
            {choices.map(([kind, label]) => (
              <label className="flex items-center gap-2" key={kind}>
                <input
                  type="checkbox"
                  checked={settings.data.enabled.includes(kind)}
                  onChange={(event) => preference.mutate({ kind, enabled: event.target.checked })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Button
            type="button"
            variant="outline"
            disabled={busy || (!settings.data.attached && !canEnable)}
            onClick={() =>
              device.mutate(settings.data.attached ? undefined : Notification.requestPermission())
            }
          >
            {settings.data.attached ? "Disable on this device" : "Enable on this device"}
          </Button>
          {!canEnable && !settings.data.attached && (
            <p className="text-sm">
              Push is unavailable or blocked here. On iPhone or iPad, open Brushy from your Home
              Screen.
            </p>
          )}
        </>
      )}
      {device.isError && <p role="alert">{device.error.message}</p>}
      {preference.isError && <p role="alert">{preference.error.message}</p>}
    </section>
  );
}
