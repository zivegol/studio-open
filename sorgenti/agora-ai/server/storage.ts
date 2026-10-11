import { GetObjectCommand, PutObjectCommand, S3Client, type PutObjectCommandInput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.S3_BUCKET ?? "";
let client: S3Client | undefined;

function s3() {
  if (!bucket || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) throw new Error("Storage S3 non configurato.");
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
  });
  return client;
}

function normalizeKey(value: string) {
  const key = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!key || key.split("/").some(part => part === ".." || part === ".")) throw new Error("Chiave storage non valida.");
  return key;
}

export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream") {
  const key = normalizeKey(relKey);
  const input: PutObjectCommandInput = { Bucket: bucket, Key: key, Body: data, ContentType: contentType };
  const serverSideEncryption = process.env.S3_SERVER_SIDE_ENCRYPTION;
  if (serverSideEncryption === "AES256" || serverSideEncryption === "aws:kms") {
    input.ServerSideEncryption = serverSideEncryption;
    if (serverSideEncryption === "aws:kms" && process.env.S3_KMS_KEY_ID) input.SSEKMSKeyId = process.env.S3_KMS_KEY_ID;
  }
  await s3().send(new PutObjectCommand(input));
  return { key, url: `s3://${bucket}/${key}` };
}

export async function storageGet(relKey: string) {
  const key = normalizeKey(relKey);
  return { key, url: await storageGetSignedUrl(key) };
}

export async function storageGetSignedUrl(relKey: string) {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: normalizeKey(relKey) }), { expiresIn: 300 });
}
