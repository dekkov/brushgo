import { afterEach, describe, expect, it, vi } from "vitest";
import { signSelfieReads, signSelfieUpload } from "./selfie-storage.server";

describe("S3 selfie signing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when storage is not configured", async () => {
    vi.stubEnv("AWS_REGION", "");
    await expect(signSelfieUpload("user/photo.jpg")).rejects.toThrow("not configured");
  });

  it("signs private PUT and GET URLs with bounded lifetimes", async () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("S3_SELFIES_BUCKET", "example-selfies");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key");
    const upload = new URL(await signSelfieUpload("user/photo.jpg"));
    const [read] = await signSelfieReads(["user/photo.jpg"]);
    const download = new URL(read!);
    expect(upload.hostname).toBe("example-selfies.s3.us-east-1.amazonaws.com");
    expect(upload.pathname).toBe("/user/photo.jpg");
    expect(upload.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(download.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(upload.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(download.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(upload.searchParams.get("X-Amz-Signature")).not.toBe(
      download.searchParams.get("X-Amz-Signature"),
    );
  });
});
