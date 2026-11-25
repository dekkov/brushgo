import { z } from "zod";

export const audienceSchema = z.enum(["only_me", "all_friends", "selected_friends"]);
export type Audience = z.infer<typeof audienceSchema>;
export const cursorSchema = z.object({
  captured_at: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});
const nameSchema = z.string().trim().min(1).max(40);
const uuid = z.string().uuid();
const friendIds = z.array(uuid).max(5);
const timeZone = z.string().min(1).max(80);
export const socialInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state"), data: z.object({}) }),
  z.object({
    action: z.literal("profile"),
    data: z.object({ display_name: nameSchema, time_zone: timeZone }),
  }),
  z.object({ action: z.literal("reset_invite"), data: z.object({}) }),
  z.object({
    action: z.literal("preview"),
    data: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) }),
  }),
  z.object({
    action: z.literal("request"),
    data: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) }),
  }),
  z.object({
    action: z.literal("respond"),
    data: z.object({ request_id: uuid, accept: z.boolean() }),
  }),
  z.object({ action: z.literal("remove"), data: z.object({ friendship_id: uuid }) }),
  z.object({ action: z.literal("block"), data: z.object({ user_id: uuid }) }),
  z.object({ action: z.literal("unblock"), data: z.object({ user_id: uuid }) }),
  z.object({
    action: z.literal("feed"),
    data: z.object({ owner_id: uuid.optional(), cursor: cursorSchema.optional() }),
  }),
  z.object({ action: z.literal("photo"), data: z.object({ id: uuid, revision: uuid }) }),
  z.object({
    action: z.literal("save"),
    data: z
      .object({
        local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        slot: z.enum(["am", "pm"]),
        photo_path: z.string().max(200),
        verified: z.boolean(),
        confidence: z.number().finite().min(0).max(1),
        audience: audienceSchema,
        friendship_ids: friendIds,
        time_zone: timeZone,
      })
      .superRefine((value, context) => {
        if (value.audience === "selected_friends" && value.friendship_ids.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["friendship_ids"],
            message: "Choose at least one friend.",
          });
        }
        if (new Set(value.friendship_ids).size !== value.friendship_ids.length) {
          context.addIssue({
            code: "custom",
            path: ["friendship_ids"],
            message: "Choose each friend only once.",
          });
        }
        if (value.audience !== "selected_friends" && value.friendship_ids.length > 0) {
          context.addIssue({
            code: "custom",
            path: ["friendship_ids"],
            message: "Only Selected friends can include individual friends.",
          });
        }
      }),
  }),
]);
export type SocialInput = z.infer<typeof socialInputSchema>;
export const personSchema = z.object({ user_id: uuid, display_name: z.string() });
export const friendSchema = personSchema.extend({
  friendship_id: uuid,
  streak: z.number().int().nonnegative(),
});
export type Friend = z.infer<typeof friendSchema>;
export const socialStateSchema = z.object({
  profile: z
    .object({
      id: uuid,
      display_name: z.string(),
      last_audience: audienceSchema,
      selected_friendship_ids: friendIds,
      time_zone: z.string(),
    })
    .nullable(),
  friends: z.array(friendSchema).max(5),
  incoming: z.array(personSchema.extend({ id: uuid })),
  outgoing: z.array(personSchema.extend({ id: uuid })),
  blocked: z.array(personSchema),
  invite: z.string().nullable(),
});
export type SocialState = z.infer<typeof socialStateSchema>;
export const feedItemSchema = z.object({
  id: uuid,
  revision: uuid,
  owner_id: uuid,
  display_name: z.string(),
  streak: z.number().int().nonnegative(),
  local_date: z.string(),
  slot: z.enum(["am", "pm"]),
  verified: z.boolean(),
  captured_at: z.string(),
  audience: audienceSchema,
});
export type FeedItem = z.infer<typeof feedItemSchema>;
export const feedSchema = z.object({
  owner: personSchema.extend({ streak: z.number().int().nonnegative() }).nullable(),
  items: z.array(feedItemSchema),
  next: cursorSchema.nullable(),
});
export const previewSchema = personSchema.extend({
  relationship: z.enum(["self", "friend", "incoming", "outgoing", "none"]),
});
export type InvitePreview = z.infer<typeof previewSchema>;

export function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function rememberedAudience(state: SocialState): {
  audience: Audience;
  friendshipIds: string[];
} {
  const active = new Set(state.friends.map((friend) => friend.friendship_id));
  return {
    audience: state.profile?.last_audience ?? "only_me",
    friendshipIds: (state.profile?.selected_friendship_ids ?? []).filter((id) => active.has(id)),
  };
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export function inviteCode(value: string) {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const token = new URLSearchParams(url.hash.slice(1)).get("invite");
    if (token && /^[a-f0-9]{64}$/i.test(token)) return token;
  } catch {
    // The form accepts either a code or a complete invite URL.
  }
  throw new Error("Paste a complete Brushy invite link or its 64-character code.");
}
