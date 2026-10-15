import { NextResponse } from "next/server";
import { createServerSso } from "@/lib/auth/sso";
import { getRequestOrigin } from "@/lib/http/origin";

export async function GET(request: Request) {
  const origin = await getRequestOrigin();
  const incomingUrl = new URL(request.url);
  const callbackUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);
  const result = await createServerSso(origin).auth.handleCallback(callbackUrl, {
    callbackBaseUrl: origin,
    allowedCallbackBaseUrls: [origin],
    fallback: "/",
    redirect: false,
  });

  if (!result.ok) {
    return NextResponse.redirect(new URL(`/login?error=sso`, origin));
  }

  return NextResponse.redirect(new URL(result.referer, origin));
}
