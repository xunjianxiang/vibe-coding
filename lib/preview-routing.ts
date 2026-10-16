export const DEFAULT_GATEWAY_NETWORK = "vibe-coding-preview";
export const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isGatewayEnabled(value = process.env.GATEWAY_ENABLED) {
  return value?.trim().toLowerCase() === "true";
}

export function gatewayNetworkName(value = process.env.GATEWAY_NETWORK) {
  return value?.trim() || DEFAULT_GATEWAY_NETWORK;
}
