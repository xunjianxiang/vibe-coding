import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  await clearSession();
  return NextResponse.redirect(new URL("/login?status=logged-out", request.url), 303);
}
