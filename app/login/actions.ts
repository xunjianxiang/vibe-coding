"use server";

import { redirect } from "next/navigation";
import { createServerSso } from "@/lib/auth/sso";
import { getRequestOrigin } from "@/lib/http/origin";

export async function login() {
  const origin = await getRequestOrigin();
  redirect(await createServerSso(origin).auth.createLoginUrl({ callbackBaseUrl: origin, returnTo: "/" }));
}
