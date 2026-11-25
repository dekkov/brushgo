import { describe, expect, it } from "vitest";
import { isOwnedLegacyPhotoPath, s3PhotoKey, s3PhotoPath } from "./selfie-path";

describe("selfie storage paths", () => {
  const user = "2eb4f214-454f-4955-84c6-1835b1588485";
  const key = `${user}/5c6e7cda-437c-4efa-b6f8-6545c9e67080.jpg`;

  it("round trips S3 paths and leaves legacy paths alone", () => {
    expect(s3PhotoKey(s3PhotoPath(key), user)).toBe(key);
    expect(s3PhotoKey(`${user}/old.jpg`, user)).toBeNull();
  });

  it("rejects other users' keys and malformed keys", () => {
    expect(() => s3PhotoKey(s3PhotoPath(key), "someone-else")).toThrow();
    expect(() => s3PhotoKey(s3PhotoPath(`${user}/../other.jpg`), user)).toThrow();
    expect(() => s3PhotoKey(s3PhotoPath(`${user}/anything.jpg`), user)).toThrow();
  });

  it("accepts only owned legacy object paths without traversal or empty segments", () => {
    expect(isOwnedLegacyPhotoPath(`${user}/old.jpg`, user)).toBe(true);
    for (const path of [`other/old.jpg`, `${user}/../old.jpg`, `${user}//old.jpg`, user]) {
      expect(isOwnedLegacyPhotoPath(path, user)).toBe(false);
    }
  });
});
