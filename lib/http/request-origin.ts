type ReadonlyHeaders = Pick<Headers, "get">;

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function parseHttpUrl(value: string | null) {
  if (!value || value === "null") return null;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function parseAuthority(authority: string | null, protocol = "http:") {
  if (!authority) return null;

  try {
    return new URL(`${protocol}//${authority}`);
  } catch {
    return null;
  }
}

function isWildcardAuthority(authority: string | null) {
  const hostname = parseAuthority(authority)?.hostname;
  return hostname === "0.0.0.0" || hostname === "[::]" || hostname === "::";
}

function matchesAuthority(url: URL, authority: string | null) {
  const candidate = parseAuthority(authority, url.protocol);
  return candidate?.origin === url.origin;
}

export function resolveRequestOrigin(requestHeaders: ReadonlyHeaders, fallbackProtocol: "http" | "https") {
  const host = firstHeaderValue(requestHeaders.get("host"));
  const forwardedHost = firstHeaderValue(requestHeaders.get("x-forwarded-host"));
  const authorities = [host, forwardedHost];

  // Browser-provided same-origin headers preserve the exact scheme the user used.
  for (const headerName of ["origin", "referer"] as const) {
    const url = parseHttpUrl(firstHeaderValue(requestHeaders.get(headerName)));
    if (url && authorities.some((authority) => matchesAuthority(url, authority))) {
      return url.origin;
    }
  }

  // Host represents the browser's request authority. Some proxies/frameworks set
  // x-forwarded-host to the server bind address (for example 0.0.0.0:3000).
  const authority = [host, forwardedHost].find((candidate) => candidate && !isWildcardAuthority(candidate));
  if (!authority) throw new Error("Unable to determine an externally reachable request host.");

  const forwardedProtocol = firstHeaderValue(requestHeaders.get("x-forwarded-proto"));
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : fallbackProtocol;
  const url = parseAuthority(authority, `${protocol}:`);
  if (!url) throw new Error("Unable to determine request origin.");
  return url.origin;
}
