import { reportLovableError } from "@/lib/lovable-error-reporting";

export async function registerServiceWorker() {
  if (!import.meta.env.PROD || !window.isSecureContext || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch (error) {
    console.error("Could not enable Brushy's offline screen", error);
    reportLovableError(error, { feature: "pwa_registration" });
  }
}
