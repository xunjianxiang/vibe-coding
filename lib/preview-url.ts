export function buildPreviewUrl(serviceUrl: string, pageHostname: string) {
  try {
    const previewUrl = new URL(serviceUrl);
    previewUrl.hostname = pageHostname;
    return previewUrl.toString();
  } catch {
    return serviceUrl;
  }
}

export function findPublishedServicePort<T extends { containerPort: number; hostPort: number }>(ports: T[], servicePort: number | null) {
  if (servicePort === null) return null;
  return ports.find((port) => port.containerPort === servicePort || port.hostPort === servicePort) ?? null;
}
