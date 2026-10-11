import fs from "fs/promises";
import path from "path";
import { ENV } from "./_core/env";
import { getNextcloudDownloadUrl, uploadToNextcloud } from "./nextcloud";

function normalizeKey(relKey: string): string {
  return relKey.replace(/\\/g, "/").replace(/^\/+/, "");
}

function ensureInsideUploads(baseDir: string, targetPath: string): void {
  const normalizedBase = path.resolve(baseDir);
  const normalizedTarget = path.resolve(targetPath);
  if (
    normalizedTarget !== normalizedBase &&
    !normalizedTarget.startsWith(`${normalizedBase}${path.sep}`)
  ) {
    throw new Error("Invalid storage key path");
  }
}

export function resolveStoragePath(relKey: string): string {
  const key = normalizeKey(relKey);
  const fullPath = path.resolve(ENV.uploadsDir, key);
  ensureInsideUploads(ENV.uploadsDir, fullPath);
  return fullPath;
}

function buildLocalFileUrl(relKey: string): string {
  const encodedKey = normalizeKey(relKey)
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
  const relativeUrl = `/api/files/${encodedKey}`;
  return ENV.appBaseUrl
    ? `${ENV.appBaseUrl.replace(/\/+$/, "")}${relativeUrl}`
    : relativeUrl;
}

async function writeLocalCopy(
  relKey: string,
  data: Buffer | Uint8Array | string
): Promise<void> {
  const fullPath = resolveStoragePath(relKey);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, data);
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  await writeLocalCopy(key, data);

  try {
    const nextcloudUpload = await uploadToNextcloud(key, data, contentType);
    if (nextcloudUpload?.publicUrl) {
      return { key, url: nextcloudUpload.publicUrl };
    }
  } catch (error) {
    console.warn("[Storage] Nextcloud mirror failed:", String(error));
  }

  return {
    key,
    url: buildLocalFileUrl(key),
  };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);

  try {
    const nextcloudUrl = await getNextcloudDownloadUrl(key);
    if (nextcloudUrl) {
      return { key, url: nextcloudUrl };
    }
  } catch (error) {
    console.warn("[Storage] Nextcloud download lookup failed:", String(error));
  }

  return {
    key,
    url: buildLocalFileUrl(key),
  };
}
