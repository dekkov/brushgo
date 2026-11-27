import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSocialSessionBoundary } from "@/hooks/useSocial";
import { clearMismatchedNotifications } from "@/lib/push-device";

export function SocialSessionBoundary() {
  useSocialSessionBoundary();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading)
      void clearMismatchedNotifications(user?.id).catch((error: unknown) => {
        console.error("Could not clear this device's previous notifications", error);
      });
  }, [loading, user?.id]);
  return null;
}
