import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { getRequestOrigin } from "@/lib/http/origin";
import {
  createSessionId,
  decryptToken,
  encryptToken,
  hashSessionId,
  InvalidSessionTokenError,
} from "@/lib/auth/crypto";

const COOKIE_NAME = "vibe_session";

export async function readSession() {
  const id = (await cookies()).get(COOKIE_NAME)?.value;
  if (!id) return null;

  const db = getDb();
  const session = await db.session.findUnique({ where: { id: hashSessionId(id) } });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await db.session.delete({ where: { id: session.id } });
    return null;
  }

  try {
    return { id: session.id, sub: session.sub, token: decryptToken(session.tokenEnc), expiresAt: session.expiresAt };
  } catch (error) {
    if (!(error instanceof InvalidSessionTokenError)) throw error;
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
}

export async function writeSession(token: string, sub: string, expiresAt: Date) {
  const id = createSessionId();
  const secure = new URL(await getRequestOrigin()).protocol === "https:";
  await getDb().session.create({
    data: { id: hashSessionId(id), sub, tokenEnc: encryptToken(token), expiresAt },
  });
  (await cookies()).set(COOKIE_NAME, id, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const id = cookieStore.get(COOKIE_NAME)?.value;
  if (id) await getDb().session.deleteMany({ where: { id: hashSessionId(id) } });
  cookieStore.delete(COOKIE_NAME);
}
