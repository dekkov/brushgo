import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { computeStreak, type BrushRow } from "../src/lib/streak.ts";
import { s3PhotoKey } from "../src/lib/selfie-path.ts";

type Friend = { friendship_id: string; user_id: string; display_name: string; streak: number };
type State = {
  profile: null | {
    id: string;
    display_name: string;
    last_audience: string;
    selected_friendship_ids: string[];
    time_zone: string;
  };
  friends: Friend[];
  incoming: { id: string; user_id: string; display_name: string }[];
  outgoing: { id: string; user_id: string; display_name: string }[];
  blocked: { user_id: string; display_name: string }[];
  invite: string | null;
};
type Saved = { id: string; revision: string };
type Feed = {
  owner: { user_id: string; display_name: string | null; streak: number } | null;
  items: (Saved & {
    owner_id: string;
    display_name: string | null;
    streak: number;
    local_date: string;
    slot: string;
    verified: boolean;
    captured_at: string;
    audience: string;
  })[];
  next: { captured_at: string; id: string } | null;
};
type User = { id: string; token: string };
type SaveOptions = {
  local_date?: string;
  slot?: string;
  photo_path?: string;
  verified?: boolean;
  confidence?: number;
  audience?: string;
  friendship_ids?: string[];
  time_zone?: string;
};

// No network/database URL is accepted: this is a fresh, memory-only PostgreSQL WASM instance.
const db = new PGlite();
let checks = 0;
const migration = await readFile(
  new URL("../docs/sql/20261125_friends.sql", import.meta.url),
  "utf8",
);

async function asRole<T>(
  role: "authenticated" | "anon",
  user: string | null,
  sql: string,
  args: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
    return tx.query<T>(sql, args);
  });
}

async function rpc<T = Record<string, unknown>>(
  user: string | null,
  action: string,
  data: unknown = {},
): Promise<T> {
  const result = await asRole<{ result: T }>(
    "authenticated",
    user,
    "select public.brushy_social($1, $2::jsonb) as result",
    [action, JSON.stringify(data)],
  );
  return result.rows[0]!.result;
}

async function denied(operation: () => Promise<unknown>, message: RegExp) {
  await assert.rejects(operation, message);
  checks++;
}

async function check(name: string, operation: () => Promise<void>) {
  await operation();
  checks++;
  console.log(`✓ ${name}`);
}

async function rawUser() {
  const id = randomUUID();
  await db.query("insert into auth.users(id) values($1)", [id]);
  return id;
}

async function user(name: string): Promise<User> {
  const id = await rawUser();
  await rpc(id, "profile", { display_name: name, time_zone: "UTC" });
  const { token } = await rpc<{ token: string }>(id, "reset_invite");
  return { id, token };
}

async function request(from: User, to: User) {
  return rpc<{ id: string }>(from.id, "request", { token: to.token });
}

async function befriend(from: User, to: User) {
  const pending = await request(from, to);
  return rpc<{ friendship_id: string }>(to.id, "respond", { request_id: pending.id, accept: true });
}

async function save(owner: string, options: SaveOptions = {}) {
  return rpc<Saved>(owner, "save", {
    local_date: "2026-01-01",
    slot: "am",
    photo_path: `s3:${owner}/${randomUUID()}.jpg`,
    verified: true,
    confidence: 0.9,
    audience: "only_me",
    friendship_ids: [],
    time_zone: "UTC",
    ...options,
  });
}

const state = (u: User) => rpc<State>(u.id, "state");
const feed = (u: User, data: unknown = {}) => rpc<Feed>(u.id, "feed", data);
const photo = (u: User, saved: Saved) =>
  rpc<{ photo_path: string; owner_id: string }>(u.id, "photo", saved);
const ids = (f: Feed) => f.items.map((item) => item.id).sort();

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create table public.brushings (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null default auth.uid() references auth.users(id),
      local_date date not null,
      slot text not null check (slot in ('am','pm')),
      photo_path text not null,
      verified boolean not null default false,
      confidence real,
      created_at timestamptz not null default now(),
      unique(user_id,local_date,slot)
    );
    alter table public.brushings enable row level security;
    create policy owner_select on public.brushings for select to authenticated using(user_id = auth.uid());
    create policy owner_insert on public.brushings for insert to authenticated with check(user_id = auth.uid());
    create policy owner_update on public.brushings for update to authenticated using(user_id = auth.uid()) with check(user_id = auth.uid());
    create policy owner_delete on public.brushings for delete to authenticated using(user_id = auth.uid());
    grant all on public.brushings to authenticated;
    grant insert(photo_path),update(photo_path) on public.brushings to authenticated;
    grant all on public.brushings to anon;
    grant select(photo_path),update(photo_path) on public.brushings to public;
  `);
  const legacyOwner = await rawUser();
  const legacy = await db.query<{ id: string }>(
    "insert into public.brushings(user_id,local_date,slot,photo_path) values($1,'2025-01-01','am',$2) returning id",
    [legacyOwner, `s3:${legacyOwner}/${randomUUID()}.jpg`],
  );
  await db.exec(migration);

  const alice = await user("Alice");
  const bob = await user("Bob");
  const cara = await user("Cara");
  const outsider = await user("Outsider");
  const unnamed = await rawUser();

  await check("migration preserves existing captures as private", async () => {
    const result = await rpc<Feed>(legacyOwner, "feed");
    assert.equal(result.items[0]!.id, legacy.rows[0]!.id);
    assert.equal(result.items[0]!.audience, "only_me");
    assert.ok(result.items[0]!.revision);
    assert.ok(result.items[0]!.captured_at);
    assert.equal((await rpc<State>(legacyOwner, "state")).profile, null);
  });

  await check(
    "real role ACLs and owner RLS: no anonymous/social helper/direct-write access",
    async () => {
      await denied(
        () => asRole("anon", null, "select public.brushy_social('state')"),
        /permission denied/,
      );
      await denied(
        () => asRole("anon", null, "select photo_path from public.brushings"),
        /permission denied/,
      );
      await denied(() => rpc(null, "state"), /Authentication required/);
      await denied(
        () => asRole("authenticated", alice.id, "select * from brushy_private.profiles"),
        /permission denied/,
      );
      await denied(
        () => asRole("authenticated", alice.id, "select brushy_private.streak($1)", [bob.id]),
        /permission denied/,
      );
      await denied(
        () =>
          asRole(
            "authenticated",
            alice.id,
            "insert into public.brushings(local_date,slot,photo_path) values('2026-01-01','am','bad')",
          ),
        /permission denied/,
      );
      await denied(
        () =>
          asRole("authenticated", alice.id, "update public.brushings set audience='all_friends'"),
        /permission denied/,
      );
      await denied(
        () => asRole("authenticated", alice.id, "update public.brushings set photo_path='bad'"),
        /permission denied/,
      );
      await denied(
        () =>
          asRole(
            "authenticated",
            alice.id,
            "update public.brushings set revision=gen_random_uuid(), captured_at=clock_timestamp(), user_id=$1",
            [bob.id],
          ),
        /permission denied/,
      );
      await denied(
        () => asRole("authenticated", alice.id, "truncate public.brushings"),
        /permission denied/,
      );
      const read = await asRole("authenticated", alice.id, "select * from public.brushings");
      assert.equal(read.rows.length, 0);
      await denied(() => rpc(outsider.id, "feed", { owner_id: alice.id }), /Profile unavailable/);
      await denied(() => rpc(outsider.id, "block", { user_id: alice.id }), /User unavailable/);
      await denied(() => rpc(outsider.id, "unblock", { user_id: alice.id }), /User unavailable/);
    },
  );

  await check("private capture works without a name; shared actions require one", async () => {
    await save(unnamed);
    assert.equal((await rpc<State>(unnamed, "state")).profile, null);
    assert.equal((await rpc<Feed>(unnamed, "feed")).items.length, 1);
    await denied(() => rpc(unnamed, "reset_invite"), /display name/);
    await denied(() => save(unnamed, { audience: "all_friends" }), /display name/);
  });

  const historical = await save(alice.id, { audience: "all_friends" });
  let ab = "";
  let ac = "";
  await check(
    "invite-only explicit mutual acceptance; preview exposes no history or streak",
    async () => {
      const preview = await rpc(bob.id, "preview", { token: alice.token });
      assert.deepEqual(Object.keys(preview).sort(), ["display_name", "relationship", "user_id"]);
      assert.equal(preview.relationship, "none");
      await denied(() => photo(bob, historical), /Photo unavailable/);
      const pending = await request(bob, alice);
      assert.equal((await state(bob)).outgoing[0]!.id, pending.id);
      assert.equal((await state(alice)).incoming[0]!.id, pending.id);
      assert.equal((await rpc(alice.id, "preview", { token: bob.token })).relationship, "incoming");
      await denied(() => request(bob, alice), /already pending/);
      await denied(() => request(alice, bob), /already pending/);
      await denied(
        () => rpc(bob.id, "respond", { request_id: pending.id, accept: true }),
        /Request unavailable/,
      );
      assert.equal((await state(alice)).friends.length, 0);
      ab = (
        await rpc<{ friendship_id: string }>(alice.id, "respond", {
          request_id: pending.id,
          accept: true,
        })
      ).friendship_id;
      ac = (await befriend(cara, alice)).friendship_id;
      assert.equal((await photo(bob, historical)).owner_id, alice.id);
      assert.equal((await rpc(bob.id, "preview", { token: alice.token })).relationship, "friend");
      await denied(() => request(alice, alice), /yourself/);
      await denied(() => request(bob, alice), /Already friends/);
      assert.deepEqual((await feed(bob, { owner_id: alice.id })).owner, {
        user_id: alice.id,
        display_name: "Alice",
        streak: 0,
      });
    },
  );

  const privateCapture = await save(alice.id, { local_date: "2026-01-02" });
  const selectedCapture = await save(alice.id, {
    local_date: "2026-01-03",
    audience: "selected_friends",
    friendship_ids: [ab],
  });
  await check(
    "all/selected/private history and safe metadata; no raw friend-row SELECT",
    async () => {
      assert.deepEqual(
        ids(await feed(bob, { owner_id: alice.id })),
        [historical.id, selectedCapture.id].sort(),
      );
      assert.deepEqual(ids(await feed(cara, { owner_id: alice.id })), [historical.id]);
      assert.deepEqual(
        ids(await feed(alice)),
        [historical.id, privateCapture.id, selectedCapture.id].sort(),
      );
      await denied(() => photo(bob, privateCapture), /Photo unavailable/);
      await denied(() => photo(cara, selectedCapture), /Photo unavailable/);
      await denied(() => photo(outsider, historical), /Photo unavailable/);
      assert.equal((await photo(bob, selectedCapture)).owner_id, alice.id);
      const exposed = (await feed(bob)).items[0]!;
      assert.deepEqual(
        Object.keys(exposed).sort(),
        [
          "id",
          "revision",
          "owner_id",
          "display_name",
          "streak",
          "local_date",
          "slot",
          "verified",
          "captured_at",
          "audience",
        ].sort(),
      );
      assert.equal(
        (
          await asRole("authenticated", bob.id, "select * from public.brushings where user_id=$1", [
            alice.id,
          ])
        ).rows.length,
        0,
      );
      await asRole("authenticated", bob.id, "delete from public.brushings where id=$1", [
        privateCapture.id,
      ]);
      assert.equal((await photo(alice, privateCapture)).owner_id, alice.id);
      const memory = (await state(alice)).profile!;
      assert.equal(memory.last_audience, "selected_friends");
      assert.deepEqual(memory.selected_friendship_ids, [ab]);
    },
  );

  await check("removal and re-add never revive selected grants or remembered IDs", async () => {
    await denied(() => rpc(outsider.id, "remove", { friendship_id: ab }), /Friendship unavailable/);
    await rpc(bob.id, "remove", { friendship_id: ab });
    await denied(() => photo(bob, selectedCapture), /Photo unavailable/);
    await denied(() => photo(bob, historical), /Photo unavailable/);
    await denied(() => feed(bob, { owner_id: alice.id }), /Profile unavailable/);
    assert.deepEqual((await state(alice)).profile!.selected_friendship_ids, []);
    assert.equal((await state(alice)).profile!.last_audience, "selected_friends");
    const readded = await befriend(bob, alice);
    assert.notEqual(readded.friendship_id, ab);
    await denied(
      () =>
        save(alice.id, {
          audience: "selected_friends",
          friendship_ids: [ab],
        }),
      /Selected friendship unavailable/,
    );
    ab = readded.friendship_id;
    assert.equal((await photo(bob, historical)).owner_id, alice.id);
    await denied(() => photo(bob, selectedCapture), /Photo unavailable/);
    await denied(() => save(alice.id, { audience: "selected_friends" }), /Choose at least one/);
  });

  await check(
    "replacement rotates revision/time, invalidates grants and rejects path recycling",
    async () => {
      const path = (await photo(alice, historical)).photo_path;
      const before = (await feed(alice)).items.find((item) => item.id === historical.id)!;
      await denied(
        () => save(alice.id, { photo_path: path, audience: "only_me" }),
        /new uploaded photo path/,
      );
      const replaced = await save(alice.id);
      assert.equal(replaced.id, historical.id);
      assert.notEqual(replaced.revision, historical.revision);
      const after = (await feed(alice)).items.find((item) => item.id === replaced.id)!;
      const captureAdvanced = await db.query<{ advanced: boolean }>(
        "select $1::timestamptz > $2::timestamptz as advanced",
        [after.captured_at, before.captured_at],
      );
      assert.equal(captureAdvanced.rows[0]!.advanced, true);
      assert.equal((await feed(alice)).items[0]!.id, replaced.id);
      await denied(() => photo(alice, historical), /Photo unavailable/);
      await denied(() => photo(bob, replaced), /Photo unavailable/);
      await denied(() => save(alice.id, { photo_path: path }), /new uploaded photo path/);
      const ownerPhoto = await photo(alice, replaced);
      assert.equal(ownerPhoto.owner_id, alice.id);
      assert.match(ownerPhoto.photo_path, /^s3:/);
      await denied(
        () => save(alice.id, { local_date: "2026-01-04", photo_path: ownerPhoto.photo_path }),
        /new uploaded photo path/,
      );
      await asRole("authenticated", alice.id, "delete from public.brushings where id=$1", [
        replaced.id,
      ]);
      await denied(
        () => save(alice.id, { photo_path: ownerPhoto.photo_path }),
        /new uploaded photo path/,
      );
    },
  );

  await check("owner deletion removes selected grants, feed access and streak credit", async () => {
    const owner = await user("Deleting owner");
    const viewer = await user("Deleting viewer");
    const { friendship_id } = await befriend(owner, viewer);
    const today = new Date().toISOString().slice(0, 10);
    const options = {
      local_date: today,
      audience: "selected_friends",
      friendship_ids: [friendship_id],
    };
    const morning = await save(owner.id, { ...options, slot: "am" });
    await save(owner.id, { ...options, slot: "pm" });
    assert.equal((await feed(viewer, { owner_id: owner.id })).owner!.streak, 1);
    const foreignDelete = await asRole(
      "authenticated",
      viewer.id,
      "delete from public.brushings where id=$1 returning id",
      [morning.id],
    );
    assert.equal(foreignDelete.rows.length, 0);
    const staleDelete = await asRole(
      "authenticated",
      owner.id,
      "delete from public.brushings where id=$1 and revision=$2 returning id",
      [morning.id, randomUUID()],
    );
    assert.equal(staleDelete.rows.length, 0);
    assert.equal((await photo(viewer, morning)).owner_id, owner.id);
    const removed = await asRole(
      "authenticated",
      owner.id,
      "delete from public.brushings where user_id=$1 and id=$2 and revision=$3 returning id",
      [owner.id, morning.id, morning.revision],
    );
    assert.equal(removed.rows.length, 1);
    const grants = await db.query(
      "select * from brushy_private.photo_grants where brushing_id=$1",
      [morning.id],
    );
    assert.equal(grants.rows.length, 0);
    await denied(() => photo(owner, morning), /Photo unavailable/);
    await denied(() => photo(viewer, morning), /Photo unavailable/);
    const after = await feed(viewer, { owner_id: owner.id });
    assert.equal(
      after.items.some((item) => item.id === morning.id),
      false,
    );
    assert.equal(after.owner!.streak, 0);
  });

  await check("blocking either way ends friendship/pending; unblock restores nothing", async () => {
    const shared = await save(alice.id, { local_date: "2026-01-05", audience: "all_friends" });
    await rpc(bob.id, "block", { user_id: alice.id });
    assert.equal((await state(bob)).blocked[0]!.user_id, alice.id);
    assert.equal(
      (await state(alice)).friends.some((f) => f.user_id === bob.id),
      false,
    );
    await denied(() => photo(bob, shared), /Photo unavailable/);
    await denied(() => rpc(bob.id, "preview", { token: alice.token }), /Invite unavailable/);
    await denied(() => rpc(alice.id, "preview", { token: bob.token }), /Invite unavailable/);
    await denied(() => request(alice, bob), /Invite unavailable/);
    await rpc(bob.id, "unblock", { user_id: alice.id });
    assert.equal((await state(bob)).friends.length, 0);
    await denied(() => photo(bob, shared), /Photo unavailable/);
    const pending = await request(alice, bob);
    await rpc(bob.id, "block", { user_id: alice.id });
    assert.equal((await state(bob)).incoming.length, 0);
    assert.equal((await state(alice)).outgoing.length, 0);
    await denied(
      () => rpc(bob.id, "respond", { request_id: pending.id, accept: true }),
      /Request unavailable/,
    );
    await rpc(bob.id, "unblock", { user_id: alice.id });
  });

  await check("legitimate invite identity permits blocking, but arbitrary IDs do not", async () => {
    await rpc(outsider.id, "preview", { token: cara.token });
    await rpc(outsider.id, "block", { user_id: cara.id });
    await denied(() => request(cara, outsider), /Invite unavailable/);
    await denied(() => rpc(alice.id, "block", { user_id: outsider.id }), /User unavailable/);
    await rpc(outsider.id, "unblock", { user_id: cara.id });
  });

  await check(
    "either-direction block guards reads/aggregates even if a stale friendship still exists",
    async () => {
      const owner = await user("Guarded owner");
      const viewer = await user("Guarded viewer");
      const friendship = await befriend(viewer, owner);
      const shared = await save(owner.id, {
        audience: "selected_friends",
        friendship_ids: [friendship.friendship_id],
      });
      const reverse = await save(viewer.id, { audience: "all_friends" });
      // Deliberately inconsistent isolated fixture checks independent block guards,
      // not just the normal block action's deletion of the active friendship.
      await db.query("insert into brushy_private.blocks(blocker_id,blocked_id) values($1,$2)", [
        owner.id,
        viewer.id,
      ]);
      assert.deepEqual((await state(owner)).profile!.selected_friendship_ids, []);
      assert.deepEqual((await state(owner)).friends, []);
      assert.deepEqual((await state(viewer)).friends, []);
      assert.equal(
        (await feed(viewer)).items.some((item) => item.owner_id === owner.id),
        false,
      );
      assert.equal(
        (await feed(owner)).items.some((item) => item.owner_id === viewer.id),
        false,
      );
      await denied(() => feed(viewer, { owner_id: owner.id }), /Profile unavailable/);
      await denied(() => feed(owner, { owner_id: viewer.id }), /Profile unavailable/);
      await denied(() => photo(viewer, shared), /Photo unavailable/);
      await denied(() => photo(owner, reverse), /Photo unavailable/);
      await denied(
        () =>
          save(owner.id, {
            audience: "selected_friends",
            friendship_ids: [friendship.friendship_id],
          }),
        /Selected friendship unavailable/,
      );
      await db.query("delete from brushy_private.blocks where blocker_id=$1 and blocked_id=$2", [
        owner.id,
        viewer.id,
      ]);
      assert.deepEqual((await state(owner)).profile!.selected_friendship_ids, [
        friendship.friendship_id,
      ]);
      assert.equal((await photo(viewer, shared)).owner_id, owner.id);
    },
  );

  await check(
    "remembered selections return only active identities after account-deletion cascades",
    async () => {
      const owner = await user("Selection owner");
      const first = await user("First selection");
      const second = await user("Second selection");
      const one = (await befriend(first, owner)).friendship_id;
      const two = (await befriend(second, owner)).friendship_id;
      const shared = await save(owner.id, {
        audience: "selected_friends",
        friendship_ids: [one, two],
      });
      await db.query("delete from auth.users where id=$1", [first.id]);
      assert.deepEqual((await state(owner)).profile!.selected_friendship_ids, [two]);
      assert.equal((await photo(second, shared)).owner_id, owner.id);
      await rpc(owner.id, "remove", { friendship_id: two });
      assert.deepEqual((await state(owner)).profile!.selected_friendship_ids, []);
      assert.equal((await state(owner)).profile!.last_audience, "selected_friends");
      await denied(
        () => save(owner.id, { audience: "selected_friends", friendship_ids: [one, two] }),
        /Selected friendship unavailable/,
      );
    },
  );

  await check(
    "reset invalidates old invite, retains pending relationships and owner-only copy state",
    async () => {
      const first = await user("First");
      const second = await user("Second");
      const pending = await request(first, second);
      const replacement = await rpc<{ token: string }>(second.id, "reset_invite");
      assert.match(replacement.token, /^[0-9a-f]{64}$/);
      assert.notEqual(replacement.token, second.token);
      await denied(() => rpc(first.id, "preview", { token: second.token }), /Invite unavailable/);
      await denied(() => rpc(first.id, "request", { token: second.token }), /Invite unavailable/);
      assert.equal(
        (await rpc(first.id, "preview", { token: replacement.token })).relationship,
        "outgoing",
      );
      assert.equal((await state(second)).invite, replacement.token);
      assert.notEqual((await state(first)).invite, replacement.token);
      assert.equal((await state(second)).incoming[0]!.id, pending.id);
      await rpc(second.id, "respond", { request_id: pending.id, accept: true });
    },
  );

  await check(
    "declines allow immediate retry; retained audit enforces five/minute across recipients",
    async () => {
      const sender = await user("Retry sender");
      const target = await user("Retry recipient");
      const another = await user("Another recipient");
      for (let attempt = 0; attempt < 5; attempt++) {
        const pending = await request(sender, attempt === 4 ? another : target);
        await rpc(attempt === 4 ? another.id : target.id, "respond", {
          request_id: pending.id,
          accept: false,
        });
      }
      await denied(() => request(sender, target), /Too many requests/);
      assert.equal((await state(sender)).outgoing.length, 0);
      await db.query(
        "update brushy_private.requests set attempted_at=clock_timestamp()-interval '61 seconds' where sender_id=$1",
        [sender.id],
      );
      assert.ok((await request(sender, target)).id);
    },
  );

  await check(
    "pending does not reserve capacity; both users' caps checked atomically; failed accept remains pending",
    async () => {
      const center = await user("Center");
      const candidates: User[] = [];
      const pending: string[] = [];
      for (let i = 0; i < 6; i++) {
        const candidate = await user(`Candidate ${i}`);
        candidates.push(candidate);
        pending.push((await request(candidate, center)).id);
      }
      assert.equal((await state(center)).incoming.length, 6);
      for (let i = 0; i < 5; i++)
        await rpc(center.id, "respond", { request_id: pending[i], accept: true });
      await denied(
        () => rpc(center.id, "respond", { request_id: pending[5], accept: true }),
        /Friend limit reached/,
      );
      assert.equal((await state(center)).friends.length, 5);
      assert.equal((await state(center)).incoming.length, 1);
      const empty = await user("Empty");
      assert.equal((await feed(empty, { owner_id: empty.id })).items.length, 0);
      const senderFull = await request(center, empty);
      await denied(
        () => rpc(empty.id, "respond", { request_id: senderFull.id, accept: true }),
        /Friend limit reached/,
      );
      const firstFriend = (await state(center)).friends[0]!;
      await rpc(center.id, "remove", { friendship_id: firstFriend.friendship_id });
      await rpc(center.id, "respond", { request_id: pending[5], accept: true });
      assert.equal((await state(center)).friends.length, 5);
      const blankHistory = await feed(candidates[5]!, { owner_id: center.id });
      assert.equal(blankHistory.items.length, 0);
      assert.equal(blankHistory.owner!.user_id, center.id);
    },
  );

  await check(
    "feed keyset pagination: 20 items, no private leaks, deterministic timestamp ties",
    async () => {
      const owner = await user("Pager");
      const viewer = await user("Viewer");
      await befriend(viewer, owner);
      for (let day = 1; day <= 23; day++) {
        await save(owner.id, {
          local_date: `2026-02-${String(day).padStart(2, "0")}`,
          audience: "all_friends",
        });
      }
      await save(owner.id, { local_date: "2026-02-24" });
      // Controlled fixture ties exercise the UUID component of the SQL keyset.
      await db.query(
        "update public.brushings set captured_at='2026-04-01T00:00:00Z' where user_id=$1",
        [owner.id],
      );
      const first = await feed(viewer, { owner_id: owner.id });
      assert.equal(first.items.length, 20);
      assert.ok(first.next);
      const second = await feed(viewer, { owner_id: owner.id, cursor: first.next });
      assert.equal(second.items.length, 3);
      assert.equal(second.next, null);
      assert.equal(new Set([...ids(first), ...ids(second)]).size, 23);
      assert.equal(
        first.items.some((item) => item.local_date === "2026-02-24"),
        false,
      );
      assert.equal(first.items[0]!.id > first.items[19]!.id, true);
    },
  );

  await check(
    "SQL current streak matches computeStreak, including private slots, gaps and owner timezone",
    async () => {
      const owner = await user("Streak owner");
      const viewer = await user("Streak friend");
      await befriend(viewer, owner);
      for (const zone of ["UTC", "Pacific/Kiritimati", "America/Los_Angeles"]) {
        const current = await db.query<{ today: string }>(
          "select (current_timestamp at time zone $1)::date::text as today",
          [zone],
        );
        const today = current.rows[0]!.today;
        const shift = (n: number) => {
          const date = new Date(`${today}T12:00:00Z`);
          date.setUTCDate(date.getUTCDate() + n);
          return date.toISOString().slice(0, 10);
        };
        const cases: BrushRow[][] = [
          [],
          [{ local_date: today, slot: "am" }],
          [
            { local_date: today, slot: "am" },
            { local_date: today, slot: "pm" },
          ],
          [-1, -2, -3].flatMap((n) =>
            (["am", "pm"] as const).map((slot) => ({ local_date: shift(n), slot })),
          ),
          [0, -1, -3].flatMap((n) =>
            (["am", "pm"] as const).map((slot) => ({ local_date: shift(n), slot })),
          ),
          [
            { local_date: today, slot: "am" },
            ...[-1, -2].flatMap((n) =>
              (["am", "pm"] as const).map((slot) => ({ local_date: shift(n), slot })),
            ),
          ],
          [1, -2].flatMap((n) =>
            (["am", "pm"] as const).map((slot) => ({ local_date: shift(n), slot })),
          ),
        ];
        for (const rows of cases) {
          await asRole("authenticated", owner.id, "delete from public.brushings where user_id=$1", [
            owner.id,
          ]);
          await rpc(owner.id, "profile", { display_name: "Streak owner", time_zone: zone });
          for (const row of rows) await save(owner.id, { ...row, time_zone: zone });
          const view = await feed(viewer, { owner_id: owner.id });
          assert.equal(
            view.owner!.streak,
            computeStreak(rows, today),
            `${zone}: ${JSON.stringify(rows)}`,
          );
          assert.equal(view.items.length, 0, "private dates never escape with aggregate streak");
          const friend = (await state(viewer)).friends.find((f) => f.user_id === owner.id)!;
          assert.equal(friend.streak, computeStreak(rows, today));
        }
      }
    },
  );

  await check(
    "direct RPC payload validation rejects forgery, invalid keys, types, dates and selections",
    async () => {
      await denied(() => rpc(alice.id, "not_an_action"), /Unknown social action/);
      await denied(() => rpc(alice.id, "state", []), /Payload must be an object/);
      await denied(() => rpc(alice.id, "state", { user_id: bob.id }), /Unexpected payload field/);
      await denied(() => rpc(alice.id, "profile", { display_name: " ", time_zone: "UTC" }), /1-40/);
      await denied(
        () => rpc(alice.id, "profile", { display_name: "x".repeat(41), time_zone: "UTC" }),
        /1-40/,
      );
      await denied(
        () => rpc(alice.id, "profile", { display_name: true, time_zone: "UTC" }),
        /Expected a string/,
      );
      await denied(
        () => rpc(alice.id, "profile", { display_name: "Alice", time_zone: "Not/AZone" }),
        /Invalid time zone/,
      );
      await denied(() => rpc(alice.id, "profile", { display_name: "Alice" }), /Missing required/);
      await denied(
        () => rpc(alice.id, "respond", { request_id: randomUUID(), accept: "false" }),
        /Accept must be boolean/,
      );
      await denied(() => rpc(alice.id, "preview", { token: randomUUID() }), /Invite unavailable/);
      await denied(
        () => save(alice.id, { photo_path: `s3:${bob.id}/${randomUUID()}.jpg` }),
        /Invalid owned/,
      );
      await denied(
        () => save(alice.id, { photo_path: `s3:${alice.id}/../${randomUUID()}.jpg` }),
        /Invalid owned/,
      );
      await denied(
        () =>
          save(alice.id, { photo_path: `s3:${alice.id}/00000000-0000-1000-8000-000000000001.jpg` }),
        /Invalid owned/,
      );
      await denied(() => save(alice.id, { confidence: -0.1 }), /Confidence/);
      await denied(() => save(alice.id, { confidence: 1.1 }), /Confidence/);
      await denied(
        () => save(alice.id, { confidence: "0.9" } as unknown as SaveOptions),
        /Invalid save field types/,
      );
      await denied(
        () => save(alice.id, { verified: "true" } as unknown as SaveOptions),
        /Invalid save field types/,
      );
      await denied(
        () => save(alice.id, { local_date: "2026-02-30" }),
        /date\/time field value out of range/,
      );
      await denied(() => save(alice.id, { local_date: "2026-2-01" }), /Invalid local date/);
      await denied(() => save(alice.id, { slot: "night" }), /Invalid slot/);
      await denied(() => save(alice.id, { audience: "public" }), /Invalid audience/);
      await denied(() => save(alice.id, { time_zone: "Fake" }), /Invalid time zone/);
      await denied(() => save(alice.id, { friendship_ids: [ac] }), /require selected_friends/);
      await denied(
        () => save(alice.id, { audience: "selected_friends", friendship_ids: [ac, ac] }),
        /Duplicate friendship/,
      );
      await denied(
        () => save(outsider.id, { audience: "selected_friends", friendship_ids: [ac] }),
        /Selected friendship unavailable/,
      );
      await denied(
        () => save(alice.id, { audience: "selected_friends", friendship_ids: [randomUUID()] }),
        /Selected friendship unavailable/,
      );
      await denied(
        () => rpc(alice.id, "feed", { cursor: { id: randomUUID() } }),
        /Missing required/,
      );
      await denied(
        () => rpc(alice.id, "feed", { cursor: { id: randomUUID(), captured_at: "infinity" } }),
        /Invalid cursor/,
      );
      await denied(
        () =>
          rpc(alice.id, "save", {
            local_date: "2026-01-01",
            slot: "am",
            photo_path: `s3:${alice.id}/${randomUUID()}.jpg`,
            verified: true,
            confidence: 1,
            audience: "all_friends",
            friendship_ids: [],
            time_zone: "UTC",
            revision: randomUUID(),
          }),
        /Unexpected payload field/,
      );
    },
  );

  await check(
    "catalog-qualified timezone validation rejects temporary-schema shadowing",
    async () => {
      await asRole(
        "authenticated",
        alice.id,
        "create temporary table pg_timezone_names(name text)",
      );
      await asRole(
        "authenticated",
        alice.id,
        "insert into pg_temp.pg_timezone_names(name) values('Attacker/Zone')",
      );
      try {
        await denied(
          () => rpc(alice.id, "profile", { display_name: "Alice", time_zone: "Attacker/Zone" }),
          /Invalid time zone/,
        );
        await denied(() => save(alice.id, { time_zone: "Attacker/Zone" }), /Invalid time zone/);
        await save(alice.id, { time_zone: "UTC", local_date: "2024-02-29" });
        await denied(
          () => save(alice.id, { local_date: "2026-02-29" }),
          /date\/time field value out of range/,
        );
      } finally {
        await asRole("authenticated", alice.id, "drop table pg_temp.pg_timezone_names");
      }
    },
  );

  await check(
    "SQL capture paths match the private S3 reader's owner prefix and v4 UUID rule",
    async () => {
      const owner = await user("Path owner");
      const owned = `s3:${owner.id}/${randomUUID().toUpperCase()}.jpg`;
      assert.equal(s3PhotoKey(owned, owner.id), owned.slice(3));
      const saved = await save(owner.id, { photo_path: owned });
      assert.equal((await photo(owner, saved)).photo_path, owned);
      for (const invalid of [
        `s3:${owner.id}/00000000-0000-1000-8000-000000000001.jpg`,
        `s3:${owner.id}/00000000-0000-4000-c000-000000000001.jpg`,
        `s3:${owner.id}/../${randomUUID()}.jpg`,
        `s3:${alice.id}/${randomUUID()}.jpg`,
      ]) {
        assert.throws(() => s3PhotoKey(invalid, owner.id), /Invalid S3/);
        await denied(() => save(owner.id, { photo_path: invalid }), /Invalid owned S3/);
      }
    },
  );

  await check(
    "deployed function ACL/search_path and deterministic lock implementation inspection",
    async () => {
      const functions = await db.query<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[];
        source: string;
        authenticated: boolean;
        anon: boolean;
        everyone: boolean;
      }>(`
      select p.proname,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) source,
        has_function_privilege('authenticated',p.oid,'execute') authenticated,
        has_function_privilege('anon',p.oid,'execute') anon,
        exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.grantee=0 and a.privilege_type='EXECUTE') everyone
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='brushy_private' or (n.nspname='public' and p.proname='brushy_social')
    `);
      for (const fn of functions.rows) {
        assert.ok(fn.proconfig.includes("search_path=pg_catalog, brushy_private, pg_temp"));
        assert.equal(fn.prosecdef, fn.proname === "brushy_social");
        assert.equal(fn.authenticated, fn.proname === "brushy_social");
        assert.equal(fn.anon, false);
        assert.equal(fn.everyone, false);
      }
      const locks = functions.rows.find((fn) => fn.proname === "lock_users")!.source;
      assert.match(locks, /order by x loop/);
      assert.match(locks, /for update/);
      const acl = await db.query<{ anon: boolean; authenticated: boolean }>(`
      select has_function_privilege('anon','public.brushy_social(text,jsonb)','execute') anon,
        has_function_privilege('authenticated','public.brushy_social(text,jsonb)','execute') authenticated
    `);
      assert.deepEqual(acl.rows[0], { anon: false, authenticated: true });
      for (const role of ["anon", "authenticated"]) {
        const tablePrivileges = await db.query<{ privilege: string; allowed: boolean }>(
          `select privilege,has_table_privilege($1,'public.brushings',privilege) allowed
           from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege`,
          [role],
        );
        for (const { privilege, allowed } of tablePrivileges.rows) {
          assert.equal(
            allowed,
            role === "authenticated" && ["SELECT", "DELETE"].includes(privilege),
            `${role} ${privilege}`,
          );
        }
      }
    },
  );

  console.log(
    `\n${checks} checks passed against isolated PostgreSQL (PGlite), including role-switched SQL/RLS.`,
  );
  console.log(
    "Concurrency limitation: one PGlite connection cannot prove races; cap tests are deterministic and locks are inspected.",
  );
} finally {
  await db.close();
}
