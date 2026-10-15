import "server-only";
import { headers } from "next/headers";
import { resolveRequestOrigin } from "@/lib/http/request-origin";

export async function getRequestOrigin() {
  const requestHeaders = await headers();
  return resolveRequestOrigin(requestHeaders, process.env.NODE_ENV === "production" ? "https" : "http");
}
