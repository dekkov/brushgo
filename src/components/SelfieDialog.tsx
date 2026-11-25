import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Brushing } from "@/hooks/useBrushings";
import { VerifiedBadge } from "./VerifiedBadge";
import { DeleteSelfieButton } from "./DeleteSelfieButton";

export function SelfieDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: Brushing | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        {item && (
          <>
            <img
              src={item.url}
              alt="Brushing selfie"
              className="aspect-[3/4] w-full object-cover"
            />
            <div className="flex items-center justify-between p-4">
              <div>
                <DialogTitle className="font-display">
                  {item.slot === "am" ? "☀️ Morning" : "🌙 Evening"}
                </DialogTitle>
                <DialogDescription>{new Date(item.created_at).toLocaleString()}</DialogDescription>
              </div>
              <VerifiedBadge verified={item.verified} />
            </div>
            <div className="px-4 pb-4">
              <DeleteSelfieButton id={item.id} revision={item.revision} onDeleted={onDeleted} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
