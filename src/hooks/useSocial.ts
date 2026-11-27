import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { socialStateSchema } from "@/lib/social";
import { socialAction } from "@/lib/social.functions";

export function useSocial() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["social", user?.id],
    queryFn: async () =>
      socialStateSchema.parse(await socialAction({ data: { action: "state", data: {} } })),
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: "always",
    staleTime: 0,
    gcTime: 0,
  });
  return query;
}

export function useSocialSessionBoundary() {
  const { user } = useAuth();
  const client = useQueryClient();
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    // Never leave another account's social metadata in the shared query cache.
    return () => {
      void client.cancelQueries({ queryKey: ["social", userId] });
      void client.cancelQueries({ queryKey: ["feed", userId] });
      void client.cancelQueries({ queryKey: ["check-in-timing", userId] });
      client.removeQueries({ queryKey: ["social", userId] });
      client.removeQueries({ queryKey: ["feed", userId] });
      client.removeQueries({ queryKey: ["check-in-timing", userId] });
    };
  }, [client, user?.id]);
}
