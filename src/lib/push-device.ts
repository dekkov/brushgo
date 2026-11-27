import { pushAction } from "@/lib/push.functions";

const vapidKey = import.meta.env["VITE_WEB_PUSH_PUBLIC_KEY"];
const ownerKey = "brushy-push-owner";

export function supportsPush() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window &&
    "PushManager" in window &&
    "serviceWorker" in navigator
  );
}

export async function deviceSubscription() {
  if (!supportsPush()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? undefined;
}

function workerSupportsNotifications(worker: ServiceWorker) {
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(ready);
    };
    const timeout = window.setTimeout(() => finish(false), 1000);
    channel.port1.onmessage = (event) => finish(event.data === true);
    worker.postMessage("brushy-push-ready", [channel.port2]);
  });
}

export async function enableDeviceNotifications(
  userId: string,
  permission: NotificationPermission,
) {
  if (!supportsPush() || !vapidKey)
    throw new Error("Notifications are not available on this device.");
  if (permission !== "granted") {
    throw new Error("Notifications are blocked or were not allowed on this device.");
  }
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration?.active || !(await workerSupportsNotifications(registration.active)))
    throw new Error("Reopen Brushy to finish setting up notifications.");
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    const status = await pushAction({
      data: { action: "status", data: { endpoint: existing.endpoint } },
    });
    if (status.attached) {
      localStorage.setItem(ownerKey, userId);
      return;
    }
    await existing.unsubscribe();
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: Uint8Array.from(
      atob(vapidKey.replace(/-/g, "+").replace(/_/g, "/")),
      (byte) => byte.charCodeAt(0),
    ),
  });
  try {
    const { keys } = subscription.toJSON();
    const p256dh = keys?.["p256dh"],
      auth = keys?.["auth"];
    if (!p256dh || !auth) throw new Error("This browser did not provide push encryption keys.");
    localStorage.setItem(ownerKey, userId);
    await pushAction({
      data: { action: "attach", userId, data: { endpoint: subscription.endpoint, p256dh, auth } },
    });
  } catch (error) {
    await subscription.unsubscribe();
    localStorage.removeItem(ownerKey);
    throw error;
  }
}

export async function disableDeviceNotifications() {
  const subscription = await deviceSubscription();
  if (!subscription) return;
  try {
    await pushAction({ data: { action: "detach", data: { endpoint: subscription.endpoint } } });
  } finally {
    await subscription.unsubscribe();
    localStorage.removeItem(ownerKey);
    await closeDeviceNotifications();
  }
}

export async function clearMismatchedNotifications(userId?: string) {
  if (!supportsPush()) return;
  const owner = localStorage.getItem(ownerKey);
  if (!owner || owner === userId) return;
  const subscription = await deviceSubscription();
  if (localStorage.getItem(ownerKey) !== owner) return;
  await subscription?.unsubscribe();
  localStorage.removeItem(ownerKey);
  await closeDeviceNotifications();
}

export async function closeDeviceNotifications() {
  if (!supportsPush()) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const notifications = (await registration?.getNotifications()) ?? [];
  notifications.forEach((notification) => notification.close());
}

export const pushConfigured = Boolean(vapidKey);
