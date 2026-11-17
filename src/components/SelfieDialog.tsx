import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Brushing } from "@/hooks/useBrushings";
import { VerifiedBadge } from "./VerifiedBadge";

export function SelfieDialog({ item, onClose }: { item: Brushing | null; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        {item && (
          <>
            <img src={item.url} alt="Brushing selfie" className="aspect-[3/4] w-full object-cover" />
            <div className="flex items-center justify-between p-4">
              <div>
                <DialogTitle className="font-display">{item.slot === "am" ? "☀️ Morning" : "🌙 Evening"}</DialogTitle>
                <p className="text-sm text-muted-foreground">{new Date(item.created_at).toLocaleString()}</p>
              </div>
              <VerifiedBadge verified={item.verified} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
