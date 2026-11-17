const S3_PREFIX = "s3:";

export function s3PhotoPath(key: string): string {
  return `${S3_PREFIX}${key}`;
}

export function s3PhotoKey(path: string, userId: string): string | null {
  if (!path.startsWith(S3_PREFIX)) return null;
  const key = path.slice(S3_PREFIX.length);
  const prefix = `${userId}/`;
  if (
    !key.startsWith(prefix) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i.test(
      key.slice(prefix.length),
    )
  ) {
    throw new Error("Invalid S3 selfie path");
  }
  return key;
}
