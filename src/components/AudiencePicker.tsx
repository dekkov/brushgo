import type { Audience, Friend } from "@/lib/social";

export function AudiencePicker({
  audience,
  friendshipIds,
  friends,
  onChange,
  disabled,
  canShare,
}: {
  audience: Audience;
  friendshipIds: string[];
  friends: Friend[];
  onChange: (audience: Audience, ids: string[]) => void;
  disabled: boolean;
  canShare: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <legend className="px-1 text-sm font-semibold">Who can see this selfie?</legend>
      <select
        aria-label="Selfie audience"
        className="w-full rounded-lg border border-border bg-background p-3"
        value={audience}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "only_me" || next === "all_friends" || next === "selected_friends") {
            onChange(next, next === "selected_friends" ? friendshipIds : []);
          }
        }}
      >
        <option value="only_me">Only me</option>
        <option value="all_friends" disabled={!canShare}>
          All friends (including future friends)
        </option>
        <option value="selected_friends" disabled={!canShare}>
          Selected friends
        </option>
      </select>
      {!canShare && (
        <p className="text-sm text-muted-foreground">
          Choose a display name in Friends before sharing.
        </p>
      )}
      {audience === "selected_friends" && (
        <div className="space-y-2">
          {friends.map((friend) => (
            <label
              key={friend.friendship_id}
              className="flex items-center gap-3 rounded-lg bg-secondary p-3"
            >
              <input
                type="checkbox"
                checked={friendshipIds.includes(friend.friendship_id)}
                onChange={(event) =>
                  onChange(
                    audience,
                    event.target.checked
                      ? [...friendshipIds, friend.friendship_id]
                      : friendshipIds.filter((id) => id !== friend.friendship_id),
                  )
                }
              />
              {friend.display_name}
            </label>
          ))}
          {friendshipIds.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              Select at least one current friend, or choose another audience.
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        This choice is saved with the selfie and cannot be edited later.{" "}
        {audience === "only_me"
          ? "This selfie stays private."
          : audience === "all_friends"
            ? "Current and future friends can see it while you are friends."
            : "Only the selected current friendships receive access; re-friending does not restore it."}
      </p>
    </fieldset>
  );
}
