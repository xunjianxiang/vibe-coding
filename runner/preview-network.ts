import Docker from "dockerode";
import { gatewayNetworkName, isGatewayEnabled, WORKSPACE_ID_PATTERN } from "@/lib/preview-routing";

const docker = new Docker();

export async function ensurePreviewNetwork() {
  const networkName = gatewayNetworkName();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(networkName)) {
    throw new Error("GATEWAY_NETWORK is not a valid Docker network name.");
  }
  const existing = (await docker.listNetworks({ filters: { name: [networkName] } }))
    .find((network) => network.Name === networkName);
  if (existing) {
    if (existing.Driver !== "bridge") throw new Error(`${networkName} must use the bridge driver.`);
    return docker.getNetwork(existing.Id);
  }
  return await docker.createNetwork({
    Name: networkName,
    Driver: "bridge",
    CheckDuplicate: true,
    Labels: { "platform.managed": "true", "platform.purpose": "preview" },
  });
}

export async function connectManagedContainerToPreviewNetwork(containerId: string, workspaceId: string) {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) throw new Error("Managed container has an invalid Workspace ID label.");
  if (!isGatewayEnabled()) {
    await disconnectManagedContainerFromPreviewNetwork(containerId);
    return;
  }
  const networkName = gatewayNetworkName();
  const network = await ensurePreviewNetwork();
  const inspected = await docker.getContainer(containerId).inspect();
  const attachment = inspected.NetworkSettings.Networks[networkName];
  await disconnectManagedContainerFromPreviewNetwork(containerId, networkName);
  if (attachment?.Aliases?.includes(workspaceId)) return;
  if (attachment) await network.disconnect({ Container: containerId, Force: true });
  await network.connect({ Container: containerId, EndpointConfig: { Aliases: [workspaceId.toLowerCase()] } });
}

export async function disconnectManagedContainerFromPreviewNetwork(containerId: string, exceptNetwork?: string) {
  const networks = await docker.listNetworks({ filters: { label: ["platform.purpose=preview"] } });
  const inspected = await docker.getContainer(containerId).inspect().catch(() => null);
  if (!inspected) return;
  for (const network of networks) {
    if (network.Name === exceptNetwork || !inspected.NetworkSettings.Networks[network.Name]) continue;
    await docker.getNetwork(network.Id).disconnect({ Container: containerId, Force: true });
  }
}
