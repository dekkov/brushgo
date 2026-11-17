import { Sparkles, Check } from "lucide-react";
export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary"><Sparkles className="h-3.5 w-3.5" />Verified brushing</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"><Check className="h-3.5 w-3.5" />Self-confirmed</span>
  );
}
