import "server-only";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { createServerSso } from "@/lib/auth/sso";
import { getRequestOrigin } from "@/lib/http/origin";

export async function requireUser(returnTo = "/") {
  const session = await readSession();
  if (session) return session;

  const origin = await getRequestOrigin();
  const url = await createServerSso(origin).auth.createLoginUrl({ callbackBaseUrl: origin, returnTo });
  redirect(url);
}
