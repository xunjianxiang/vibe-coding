import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { requireEnvironment } from "@/lib/config";

export class InvalidSessionTokenError extends Error {
  constructor(options?: ErrorOptions) {
    super("Invalid encrypted session token.", options);
    this.name = "InvalidSessionTokenError";
  }
}

function getKey() {
  return createHash("sha256").update(requireEnvironment("SESSION_ENCRYPTION_KEY"), "utf8").digest();
}

export function hashSessionId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createSessionId() {
  return randomBytes(32).toString("base64url");
}

export function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptToken(value: string) {
  // Resolve configuration before classifying ciphertext errors so a missing key
  // remains an operational failure instead of silently logging the user out.
  const key = getKey();
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new InvalidSessionTokenError();
  }

  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
    throw new InvalidSessionTokenError();
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new InvalidSessionTokenError({ cause: error });
  }
}
