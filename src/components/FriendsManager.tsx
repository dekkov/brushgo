import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOnline } from "@/hooks/useOnline";
import { useSocial } from "@/hooks/useSocial";
import {
  currentTimeZone,
  initials,
  inviteCode,
  previewSchema,
  type InvitePreview,
  type SocialInput,
} from "@/lib/social";
import { socialAction } from "@/lib/social.functions";

export function FriendsManager() {
  const state = useSocial();
  const online = useOnline();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profile = state.data?.profile;

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("invite");
    if (token) setCode(token);
  }, []);

  async function run(input: SocialInput, success: string) {
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    try {
      await socialAction({ data: input });
      setPreview(null);
      setPreviewToken(null);
      // Remove rendered photo blobs after any relationship change before refetching.
      await client.resetQueries({ queryKey: ["feed"] });
      await client.invalidateQueries({ queryKey: ["social"] });
      toast.success(success);
    } catch (error) {
      console.error("Could not update Friends", error);
      setError(error instanceof Error ? error.message : "Could not update Friends. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function inspectInvite(event: FormEvent) {
    event.preventDefault();
    if (!online || busy) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setPreviewToken(null);
    try {
      const token = inviteCode(code);
      const result = previewSchema.parse(
        await socialAction({ data: { action: "preview", data: { token } } }),
      );
      setPreview(result);
      setPreviewToken(token);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not look up this invite.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!state.data?.invite) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/friends#invite=${state.data.invite}`,
      );
      toast.success("Invite link copied.");
    } catch (error) {
      console.error("Could not copy friend invite", error);
      setError("Could not copy the invite. Copy the code below instead.");
    }
  }

  if (state.isPending)
    return <p role="status">{online ? "Loading Friends…" : "Reconnect to load Friends."}</p>;
  if (state.isError)
    return (
      <div role="alert" className="space-y-3 rounded-xl bg-card p-5">
        <p>{state.error.message}</p>
        <Button variant="outline" disabled={!online} onClick={() => void state.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (!state.data) return null;
  const friends = state.data.friends;
  const disabled = busy || !online;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Friends</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A small circle for your brushing habit. {friends.length} of 5 friends.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-destructive p-4">
          {error}
        </p>
      )}
      <form
        className="space-y-3 rounded-xl bg-card p-4 shadow-soft"
        onSubmit={(event) => {
          event.preventDefault();
          const name = new FormData(event.currentTarget).get("display_name");
          if (typeof name === "string")
            void run(
              {
                action: "profile",
                data: { display_name: name.trim(), time_zone: currentTimeZone() },
              },
              "Display name saved.",
            );
        }}
      >
        <label className="block space-y-2 font-semibold">
          <span>Your display name</span>
          <Input
            key={profile?.display_name}
            name="display_name"
            required
            minLength={1}
            maxLength={40}
            defaultValue={profile?.display_name ?? ""}
            placeholder="What should friends call you?"
            disabled={disabled}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Names need not be unique. Your email stays private.
        </p>
        <Button type="submit" disabled={disabled}>
          Save name
        </Button>
      </form>

      {!!profile?.display_name && (
        <>
          <section
            aria-label="Your invite"
            className="space-y-3 rounded-xl bg-card p-4 shadow-soft"
          >
            <h2 className="font-display text-lg font-bold">Invite a friend</h2>
            <p className="text-sm text-muted-foreground">
              An invite only lets someone request friendship. You still choose Accept or Decline.
            </p>
            {state.data.invite ? (
              <>
                <label className="block text-sm">
                  Your reusable friend code
                  <Input
                    readOnly
                    value={state.data.invite}
                    className="mt-2 font-mono text-xs"
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void copyInvite()} disabled={disabled}>
                    Copy invite link
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Reset your invite? Previously shared links and codes will stop working. Existing friends and requests stay.",
                        )
                      )
                        void run({ action: "reset_invite", data: {} }, "Invite reset.");
                    }}
                  >
                    Reset invite
                  </Button>
                </div>
              </>
            ) : (
              <Button
                disabled={disabled}
                onClick={() => void run({ action: "reset_invite", data: {} }, "Invite created.")}
              >
                Create invite
              </Button>
            )}
          </section>

          <form onSubmit={inspectInvite} className="space-y-3 rounded-xl bg-card p-4 shadow-soft">
            <label className="block space-y-2 font-semibold">
              <span>Add a friend</span>
              <Input
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setPreview(null);
                  setPreviewToken(null);
                }}
                placeholder="Paste an invite link or code"
                required
                disabled={disabled}
              />
            </label>
            <Button type="submit" variant="outline" disabled={disabled}>
              Look up invite
            </Button>
            {preview && (
              <div className="space-y-3 rounded-lg bg-secondary p-4">
                <p className="font-semibold">{preview.display_name}</p>
                {preview.relationship === "none" && previewToken ? (
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      void run(
                        { action: "request", data: { token: previewToken } },
                        "Friend request sent.",
                      )
                    }
                    type="button"
                  >
                    Send friend request
                  </Button>
                ) : (
                  <p>
                    {preview.relationship === "self"
                      ? "This is your invite."
                      : preview.relationship === "friend"
                        ? "You are already friends."
                        : preview.relationship === "incoming"
                          ? "They already requested you. Accept or decline below."
                          : "Your request is pending."}
                  </p>
                )}
                {friends.length >= 5 && preview.relationship === "none" && (
                  <p className="text-sm">
                    Your friend list is full. A friendship cannot be accepted until you have a free
                    place.
                  </p>
                )}
              </div>
            )}
          </form>

          <section className="space-y-3" aria-label="Friend requests">
            <h2 className="font-display text-xl font-bold">Requests</h2>
            {state.data.incoming.map((person) => (
              <div
                key={person.id}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-4"
              >
                <span className="mr-auto font-semibold">{person.display_name}</span>
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    void run(
                      { action: "respond", data: { request_id: person.id, accept: true } },
                      "Friend request accepted.",
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    void run(
                      { action: "respond", data: { request_id: person.id, accept: false } },
                      "Request declined.",
                    )
                  }
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    void run(
                      { action: "block", data: { user_id: person.user_id } },
                      "Person blocked.",
                    )
                  }
                >
                  Block
                </Button>
              </div>
            ))}
            {state.data.outgoing.map((person) => (
              <div
                key={person.id}
                className="flex items-center justify-between rounded-xl bg-card p-4"
              >
                <span>{person.display_name}</span>
                <span className="text-sm text-muted-foreground">Pending</span>
              </div>
            ))}
            {!state.data.incoming.length && !state.data.outgoing.length && (
              <p className="text-sm text-muted-foreground">No pending requests.</p>
            )}
          </section>

          <section className="space-y-3" aria-label="Accepted friends">
            <h2 className="font-display text-xl font-bold">Your friends · {friends.length}/5</h2>
            {friends.map((friend) => (
              <div
                key={friend.friendship_id}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-4"
              >
                <span
                  aria-hidden
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary font-semibold"
                >
                  {initials(friend.display_name)}
                </span>
                <Link
                  to="/friends/$userId"
                  params={{ userId: friend.user_id }}
                  className="min-w-0 flex-1 break-words font-semibold hover:underline"
                >
                  {friend.display_name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {friend.streak} day streak
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${friend.display_name}? You will lose access to each other's shared photos.`,
                      )
                    )
                      void run(
                        { action: "remove", data: { friendship_id: friend.friendship_id } },
                        "Friend removed.",
                      );
                  }}
                >
                  Remove
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Block ${friend.display_name}? This ends your friendship and prevents new requests.`,
                      )
                    )
                      void run(
                        { action: "block", data: { user_id: friend.user_id } },
                        "Person blocked.",
                      );
                  }}
                >
                  Block
                </Button>
              </div>
            ))}
            {!friends.length && (
              <p className="text-sm text-muted-foreground">Share an invite to start your circle.</p>
            )}
          </section>
          {state.data.blocked.length > 0 && (
            <section className="space-y-3" aria-label="Blocked people">
              <h2 className="font-display text-xl font-bold">Blocked</h2>
              {state.data.blocked.map((person) => (
                <div
                  key={person.user_id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-card p-4"
                >
                  <span>{person.display_name}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() =>
                      void run(
                        { action: "unblock", data: { user_id: person.user_id } },
                        "Unblocked. Friendship was not restored.",
                      )
                    }
                  >
                    Unblock
                  </Button>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
