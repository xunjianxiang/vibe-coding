import { createServer } from "node:http";
import httpProxy from "http-proxy";

const listenPort = 8080;
const workspacePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestTargets = new WeakMap();

function validIpv4(value) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function parseTarget(request) {
  const hostname = (request.headers.host || "").split(":")[0].toLowerCase().replace(/\.$/, "");
  const isLocalhost = hostname.endsWith(".localhost");
  const suffix = isLocalhost ? ".localhost" : ".nip.io";
  if (!hostname.endsWith(suffix)) return null;
  const labels = hostname.slice(0, -suffix.length).split(".");
  if ((isLocalhost && labels.length !== 2) || (!isLocalhost && labels.length !== 3)
    || !workspacePattern.test(labels[0]) || !/^\d{1,5}$/.test(labels[1])
    || (!isLocalhost && !validIpv4(labels[2].replaceAll("-", ".")))) return null;
  const port = Number(labels[1]);
  return port >= 1 && port <= 65_535 ? { workspaceId: labels[0], port } : null;
}

function writeError(response, status, message) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  response.end(message);
}

function prepareProxyRequest(proxyRequest, request) {
  const target = requestTargets.get(request);
  if (target) proxyRequest.setHeader("host", `localhost:${target.port}`);
}

const proxy = httpProxy.createProxyServer({ changeOrigin: false, proxyTimeout: 120_000, timeout: 120_000, ws: true, xfwd: true });
proxy.on("proxyReq", prepareProxyRequest);
proxy.on("proxyReqWs", prepareProxyRequest);
proxy.on("proxyRes", (proxyResponse, request) => {
  const target = requestTargets.get(request);
  const location = proxyResponse.headers.location;
  if (target && location) {
    const externalOrigin = `http://${request.headers.host || ""}`;
    proxyResponse.headers.location = location
      .replace(`http://${target.workspaceId}:${target.port}`, externalOrigin)
      .replace(`http://localhost:${target.port}`, externalOrigin);
  }
  requestTargets.delete(request);
});
proxy.on("error", (_error, request, response) => {
  requestTargets.delete(request);
  if (response && "writeHead" in response && !response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
  if (response && "end" in response) response.end("Preview service is unavailable.");
});

const server = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ok");
    return;
  }
  const target = parseTarget(request);
  if (!target) return writeError(response, 404, "Preview route not found.");
  requestTargets.set(request, target);
  proxy.web(request, response, { target: `http://${target.workspaceId}:${target.port}` });
});

server.on("upgrade", (request, socket, head) => {
  const target = parseTarget(request);
  if (!target) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  requestTargets.set(request, target);
  proxy.ws(request, socket, head, { target: `http://${target.workspaceId}:${target.port}` });
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`Preview Gateway listening on 0.0.0.0:${listenPort}.`);
});
