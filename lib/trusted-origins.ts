function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Invalid trusted origin: ${value}`);
  }
  return url.origin;
}

export function isWebSocketOriginAllowed(origin: string | undefined, host: string | undefined) {
  if (!origin || !host) return false;
  let normalizedOrigin: string;
  try {
    normalizedOrigin = normalizeOrigin(origin);
  } catch {
    return false;
  }
  return new URL(normalizedOrigin).host.toLowerCase() === host.toLowerCase();
}

