import { useEffect } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstall } from "@/hooks/useInstall";
import { useOnline } from "@/hooks/useOnline";
import { registerServiceWorker } from "@/lib/pwa";

export function PwaSupport() {
  const online = useOnline();
  const install = useInstall();

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-4">
      {!online && (
        <p role="status" className="rounded-xl border border-border bg-card p-3 text-sm">
          You are offline. Reconnect to sign in, view check-ins, or save a selfie. Any unsaved
          selfie stays here while this page is open; it has not been saved.
        </p>
      )}
      {online && install.visible && (
        <aside
          aria-label="Install Brushy"
          className="relative rounded-xl border border-border bg-card p-4 pr-12 text-sm shadow-soft"
        >
          <p className="font-semibold">Keep Brushy on your home screen</p>
          <p className="mt-1 text-muted-foreground">{install.instructions}</p>
          <p className="mt-1 text-muted-foreground">
            Free to install. An internet connection is still required.
          </p>
          {install.canPrompt && (
            <Button className="mt-3" size="sm" onClick={install.install} disabled={install.busy}>
              <Download className="h-4 w-4" /> Install Brushy
            </Button>
          )}
          {install.error && (
            <p role="alert" className="mt-2 text-destructive">
              {install.error}
            </p>
          )}
          <button
            onClick={install.dismiss}
            className="absolute right-2 top-2 rounded-full p-2 hover:bg-secondary"
            aria-label="Dismiss install guidance"
          >
            <X className="h-4 w-4" />
          </button>
        </aside>
      )}
    </div>
  );
}
