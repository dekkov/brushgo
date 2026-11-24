import { describe, expect, it } from "vitest";
import { installInstructions, installPlatform } from "./useInstall";

describe("installation platforms", () => {
  it.each([
    ["iPhone", 0, "ios"],
    ["iPad", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X)", 0, null],
    ["Linux; Android 14", 5, "android"],
    ["Windows NT 10.0", 0, null],
  ] as const)("classifies %s with %i touch points", (agent, touch, result) => {
    expect(installPlatform(agent, touch)).toBe(result);
  });

  it.each(["CriOS Safari", "FxiOS Safari", "Instagram Safari", "FBAV Safari"])(
    "directs unsupported iOS browser %s to Safari",
    (agent) => expect(installInstructions("ios", agent)).toMatch(/^Open this page in Safari/),
  );
  it.each([
    "Chrome/130.0; wv)",
    "SamsungBrowser Chrome/130.0",
    "Firefox/130.0",
    "Instagram Chrome/130.0",
  ])("directs unsupported Android browser %s to Chrome", (agent) =>
    expect(installInstructions("android", agent)).toMatch(/^Open this page in Chrome/),
  );
});
