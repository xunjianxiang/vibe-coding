import "server-only";
import { headers } from "next/headers";
import { resolveRequestOrigin } from "@/lib/http/request-origin";

export async function getRequestOrigin() {
  const requestHeaders = await headers();
  // The built-in server listens over HTTP in every mode. An HTTPS reverse proxy
  // must identify the browser-facing protocol with X-Forwarded-Proto.
  return resolveRequestOrigin(requestHeaders, "http");
}
