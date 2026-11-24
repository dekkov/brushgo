import { useEffect, useState } from "react";

export type InstallPlatform = "ios" | "android" | null;
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "brushy-install-dismissed";
let dismissedInMemory = false;

export function installPlatform(userAgent: string, touchPoints: number): InstallPlatform {
  if (/iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1)) {
    return "ios";
  }
  return /Android/i.test(userAgent) ? "android" : null;
}

export function installInstructions(platform: InstallPlatform, userAgent: string) {
  const inApp = /FBAN|FBAV|Instagram|Line\/|; wv\)|WebView/i.test(userAgent);
  if (platform === "ios") {
    const safari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
    return safari && !inApp
      ? 'In Safari, open Share, then choose "Add to Home Screen". If shown, leave "Open as Web App" on.'
      : "Open this page in Safari, then use Share > Add to Home Screen.";
  }
  return /Chrome\//i.test(userAgent) && !/EdgA|OPR|SamsungBrowser/i.test(userAgent) && !inApp
    ? 'In Chrome, open the menu, then choose "Add to Home screen" or "Install app" if available.'
    : "Open this page in Chrome on Android, then use the menu to add Brushy to your home screen.";
}

function wasDismissed() {
  try {
    return dismissedInMemory || sessionStorage.getItem(DISMISSED_KEY) === "true";
  } catch (error) {
    console.warn("Brushy install preference storage is unavailable", error);
    return dismissedInMemory;
  }
}

export function useInstall() {
  const [platform, setPlatform] = useState<InstallPlatform>(null);
  const [standalone, setStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const syncStandalone = () =>
      setStandalone(
        display.matches || ("standalone" in navigator && navigator.standalone === true),
      );
    setPlatform(installPlatform(navigator.userAgent, navigator.maxTouchPoints));
    setDismissed(wasDismissed());
    syncStandalone();
    const beforeInstall = (event: Event) => {
      const candidate = event as InstallPrompt;
      if (typeof candidate.prompt !== "function" || !candidate.userChoice) return;
      // Desktop browsers keep their own installation UI.
      if (!installPlatform(navigator.userAgent, navigator.maxTouchPoints)) return;
      event.preventDefault();
      setPrompt(candidate);
    };
    const installed = () => {
      setStandalone(true);
      setPrompt(null);
    };
    display.addEventListener("change", syncStandalone);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      display.removeEventListener("change", syncStandalone);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  function dismiss() {
    dismissedInMemory = true;
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "true");
    } catch (error) {
      console.warn("Could not remember Brushy install dismissal for this session", error);
    }
  }

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    setError(null);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setDismissed(true);
    } catch (error) {
      console.error("Could not open Brushy installation", error);
      setError("Installation could not open. Use the browser instructions instead.");
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  return {
    visible: platform !== null && !standalone && !dismissed,
    instructions: platform ? installInstructions(platform, navigator.userAgent) : "",
    canPrompt: prompt !== null,
    busy,
    error,
    install,
    dismiss,
  };
}
