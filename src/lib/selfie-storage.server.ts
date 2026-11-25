import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function storage() {
  const region = process.env["AWS_REGION"];
  const bucket = process.env["S3_SELFIES_BUCKET"];
  const accessKeyId = process.env["AWS_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"];
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 selfie storage is not configured");
  }
  return {
    bucket,
    client: new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
    }),
  };
}

export async function signSelfieUpload(key: string): Promise<string> {
  const { client, bucket } = storage();
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "image/jpeg" }),
    { expiresIn: 300 },
  );
}

export async function signSelfieReads(keys: string[]): Promise<string[]> {
  const { client, bucket } = storage();
  return Promise.all(
    keys.map((key) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 }),
    ),
  );
}

export async function readSelfie(key: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const { client, bucket } = storage();
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    signal ? { abortSignal: signal } : undefined,
  );
  if (!response.Body) throw new Error("Selfie storage returned an empty body");
  return response.Body.transformToWebStream();
}
