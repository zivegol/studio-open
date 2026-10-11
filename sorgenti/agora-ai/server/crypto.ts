import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey() {
  const secret = process.env.AGORA_ENCRYPTION_KEY || (process.env.NODE_ENV === "test" ? Buffer.alloc(32, 7).toString("base64") : "");
  if (!secret) throw new Error("Impossibile proteggere le chiavi API: manca il segreto del server.");
  const decoded = Buffer.from(secret, "base64");
  if (decoded.length !== 32) throw new Error("AGORA_ENCRYPTION_KEY deve contenere esattamente 32 byte codificati Base64.");
  return decoded;
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string) {
  const [version, ivValue, tagValue, encryptedValue] = payload.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Formato della chiave protetta non valido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
