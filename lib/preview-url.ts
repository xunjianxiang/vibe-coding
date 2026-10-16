import { isGatewayEnabled } from "./preview-routing";

const workspaceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function parseGatewayConfig(ipValue: string | undefined, portValue: string | undefined) {
  const ip = ipValue?.trim().toLowerCase() || "localhost";
  const port = Number(portValue?.trim());
  const ipParts = ip.split(".").map(Number);
  if ((ip !== "localhost" && (!ipv4Pattern.test(ip) || !ipParts.every((part) => part >= 0 && part <= 255)))
    || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { ip, port };
}

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

export function buildGatewayPreviewUrl(
  workspaceId: string,
  containerPort: number,
  gatewayIp = process.env.GATEWAY_IP,
  gatewayPort = process.env.GATEWAY_PORT,
  gatewayEnabled = process.env.GATEWAY_ENABLED,
) {
  if (!isGatewayEnabled(gatewayEnabled)) return null;
  const gateway = parseGatewayConfig(gatewayIp, gatewayPort);
  if (!gateway || !workspaceIdPattern.test(workspaceId)
    || !Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65_535) return null;
  const hostname = gateway.ip === "localhost"
    ? `${workspaceId.toLowerCase()}.${containerPort}.localhost`
    : `${workspaceId.toLowerCase()}.${containerPort}.${gateway.ip.replaceAll(".", "-")}.nip.io`;
  return `http://${hostname}:${gateway.port}/`;
}
