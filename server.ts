import "dotenv/config";
import { createServer } from "node:http";
import { connect } from "node:net";
import next from "next";
import { RUNNER_SOCKET_PATH } from "./lib/runner-socket";

const dev = !process.argv.includes("--production");
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);

async function main() {
  const server = createServer();
  const app = next({ dev, hostname, port, httpServer: server });
  const handle = app.getRequestHandler();
  await app.prepare();
  server.on("request", (request, response) => void handle(request, response));

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "/", `http://${request.headers.host || hostname}`).pathname;
    if (pathname !== "/ws/terminal" && pathname !== "/ws/events") return;

    const upstream = connect(RUNNER_SOCKET_PATH);
    upstream.once("connect", () => {
      const requestLine = `${request.method || "GET"} ${request.url || "/ws/terminal"} HTTP/${request.httpVersion}\r\n`;
      const headers: string[] = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        headers.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
      }
      upstream.write(`${requestLine}${headers.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.once("error", () => {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
