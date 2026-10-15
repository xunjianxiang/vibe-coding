export function buildPreviewUrl(serviceUrl: string, pageHostname: string) {
  try {
    const previewUrl = new URL(serviceUrl);
    previewUrl.hostname = pageHostname;
    return previewUrl.toString();
  } catch {
    return serviceUrl;
  }
}
