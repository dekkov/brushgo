import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useOnline } from "@/hooks/useOnline";
import { deleteSelfie } from "@/lib/selfie.functions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function DeleteSelfieButton({
  id,
  revision,
  onDeleted,
}: {
  id: string;
  revision: string;
  onDeleted?: (() => void) | undefined;
}) {
  const online = useOnline();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    if (deleting || !online) return;
    setDeleting(true);
    setError(undefined);
    try {
      await deleteSelfie({ data: { id, revision } });
    } catch (error) {
      console.error("Could not delete selfie", error);
      setError(error instanceof Error ? error.message : "Could not delete this selfie. Try again.");
      return;
    } finally {
      setDeleting(false);
    }
    setOpen(false);
    onDeleted?.();
    toast.success("Selfie and check-in deleted.");
    void Promise.all([
      client.resetQueries({ queryKey: ["feed"] }),
      client.invalidateQueries({ queryKey: ["social"] }),
    ]).catch((error) => {
      console.error("Could not refresh after deleting selfie", error);
      toast.error("Selfie deleted, but the feed could not refresh. Refresh the page.");
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        setError(undefined);
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={!online}
        >
          <Trash2 className="h-4 w-4" />
          Delete selfie
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onEscapeKeyDown={(event) => deleting && event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this selfie?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the stored image and its morning/evening check-in, including access for
            friends. Your streak may decrease. This cannot be undone in the app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!online && <p role="status">Reconnect to delete this selfie.</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleting || !online}
            onClick={() => void remove()}
          >
            {deleting ? "Deleting…" : "Delete selfie and check-in"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
