import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Flame, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOnline } from "@/hooks/useOnline";
import { feedSchema, initials } from "@/lib/social";
import { socialAction } from "@/lib/social.functions";
import { PrivateSelfie } from "@/components/PrivateSelfie";
import { DeleteSelfieButton } from "@/components/DeleteSelfieButton";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { cursorSchema } from "@/lib/social";

type Cursor = z.infer<typeof cursorSchema> | undefined;

export function FriendsFeed({ ownerId, onDeleted }: { ownerId?: string; onDeleted?: () => void }) {
  const { user } = useAuth();
  const online = useOnline();
  const feed = useInfiniteQuery({
    queryKey: ["feed", user?.id, ownerId],
    initialPageParam: undefined as Cursor,
    queryFn: async ({ pageParam }) =>
      feedSchema.parse(
        await socialAction({
          data: {
            action: "feed",
            data: {
              ...(ownerId ? { owner_id: ownerId } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: !!user && online,
    retry: false,
    refetchOnWindowFocus: "always",
    gcTime: 0,
  });
  const { refetch } = feed;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void refetch();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [refetch]);
  const items = [
    ...new Map(
      (feed.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item]),
    ).values(),
  ];
  const owner = !feed.isError ? feed.data?.pages[0]?.owner : undefined;

  if (!user) return null;
  return (
    <section className="space-y-4" aria-label="Selfie feed">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold">
          {ownerId ? `${owner?.display_name ?? "Friend"}'s selfies` : "You & your friends"}
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={!online || feed.isFetching}
          onClick={() => void feed.refetch()}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
      {owner && <p className="text-sm text-muted-foreground">{owner.streak} day brushing streak</p>}
      {!online ? (
        <p role="status">Reconnect to view shared selfies.</p>
      ) : feed.isError ? (
        <p role="alert" className="rounded-xl bg-secondary p-4">
          {feed.error.message}
        </p>
      ) : feed.isPending ? (
        <p role="status">Loading selfies…</p>
      ) : (
        <>
          {items.length === 0 && (
            <p className="rounded-xl bg-card p-5 text-muted-foreground">
              {ownerId
                ? "No selfies have been shared with you here yet."
                : "No shared selfies yet. Your own selfies also appear here."}
            </p>
          )}
          {items.map((item) => (
            <article
              key={`${item.id}:${item.revision}`}
              className="space-y-3 rounded-[var(--radius)] bg-card p-4 shadow-soft"
            >
              <header className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold"
                >
                  {initials(item.display_name || "Me")}
                </span>
                <div className="min-w-0 flex-1">
                  {item.owner_id === user.id ? (
                    <p className="truncate font-semibold">{item.display_name || "You"} · You</p>
                  ) : (
                    <Link
                      to="/friends/$userId"
                      params={{ userId: item.owner_id }}
                      className="block truncate font-semibold underline-offset-4 hover:underline"
                    >
                      {item.display_name}
                    </Link>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.captured_at).toLocaleString()} ·{" "}
                    {item.slot === "am" ? "Morning" : "Evening"}
                  </p>
                </div>
                <span className="flex items-center gap-1 text-sm font-semibold">
                  <Flame aria-label="day streak" className="h-4 w-4 text-flame" />
                  {item.streak}
                </span>
              </header>
              <PrivateSelfie
                id={item.id}
                revision={item.revision}
                viewerId={user.id}
                alt={`${item.display_name || "Your"} brushing selfie`}
              />
              {item.owner_id === user.id && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {item.audience === "only_me"
                      ? "Only you"
                      : item.audience === "all_friends"
                        ? "Shared with all friends"
                        : "Shared with selected friends"}
                  </p>
                  <DeleteSelfieButton id={item.id} revision={item.revision} onDeleted={onDeleted} />
                </div>
              )}
            </article>
          ))}
          {feed.hasNextPage && (
            <Button
              variant="outline"
              className="w-full"
              disabled={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              Load older selfies
            </Button>
          )}
        </>
      )}
    </section>
  );
}
