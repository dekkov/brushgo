import { describe, expect, it } from "vitest";
import { initials, rememberedAudience, socialInputSchema, type SocialState } from "./social";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const state: SocialState = {
  profile: {
    id: first,
    display_name: "Test",
    last_audience: "selected_friends",
    selected_friendship_ids: [first, second],
    time_zone: "UTC",
  },
  friends: [{ friendship_id: second, user_id: second, display_name: "Friend", streak: 3 }],
  incoming: [],
  outgoing: [],
  blocked: [],
  invite: null,
};

describe("selfie audiences", () => {
  it("remembers only still-active friendships without selecting new friends", () => {
    expect(rememberedAudience(state)).toEqual({
      audience: "selected_friends",
      friendshipIds: [second],
    });
  });
  it("does not silently broaden an empty Selected friends audience", () => {
    expect(rememberedAudience({ ...state, friends: [] })).toEqual({
      audience: "selected_friends",
      friendshipIds: [],
    });
  });
  it("starts private before any preference exists", () => {
    expect(rememberedAudience({ ...state, profile: null })).toEqual({
      audience: "only_me",
      friendshipIds: [],
    });
  });
  const save = {
    action: "save",
    data: {
      local_date: "2026-11-25",
      slot: "am",
      photo_path: `s3:${first}/${second}.jpg`,
      verified: true,
      confidence: 0.9,
      audience: "selected_friends",
      friendship_ids: [second],
      time_zone: "UTC",
    },
  };
  it("validates the save boundary and requires selected recipients", () => {
    expect(socialInputSchema.safeParse(save).success).toBe(true);
    expect(
      socialInputSchema.safeParse({ ...save, data: { ...save.data, friendship_ids: [] } }).success,
    ).toBe(false);
    expect(
      socialInputSchema.safeParse({
        ...save,
        data: { ...save.data, friendship_ids: [second, second] },
      }).success,
    ).toBe(false);
    expect(
      socialInputSchema.safeParse({ ...save, data: { ...save.data, audience: "all_friends" } })
        .success,
    ).toBe(false);
  });
  it("does not accept arbitrary action names or invalid friend identifiers", () => {
    expect(socialInputSchema.safeParse({ action: "admin", data: {} }).success).toBe(false);
    expect(
      socialInputSchema.safeParse({ action: "block", data: { user_id: "not-an-id" } }).success,
    ).toBe(false);
  });
  it("builds initials without exposing an email address", () => {
    expect(initials("  Ada  Lovelace ")).toBe("AL");
  });
});
