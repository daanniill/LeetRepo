import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { createPool, DataStore } from "./database.js";

const config = loadConfig();
const pool = createPool(config);
const store = new DataStore(pool);
const api = createApi({ config, store });
await store.cleanupExpiredData();
const cleanupTimer = setInterval(() => {
  store.cleanupExpiredData().catch(() => {});
}, 6 * 60 * 60 * 1000);
cleanupTimer.unref();

async function bodyFor(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > config.maxRequestBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (incoming, outgoing) => {
  const startedAt = Date.now();
  let status = 500;
  try {
    const url = new URL(incoming.url || "/", config.publicBaseUrl);
    const body = await bodyFor(incoming);
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body
    });
    const response = await api(request);
    status = response.status;
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    status = error.message === "REQUEST_TOO_LARGE" ? 413 : 500;
    outgoing.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    outgoing.end(JSON.stringify({ error: { code: status === 413 ? "REQUEST_TOO_LARGE" : "INTERNAL_ERROR", message: status === 413 ? "Request body is too large." : "The service could not complete this request." } }));
  } finally {
    const pathname = new URL(incoming.url || "/", config.publicBaseUrl).pathname;
    process.stdout.write(`${incoming.method || "GET"} ${pathname} ${status} ${Date.now() - startedAt}ms\n`);
  }
});

server.listen(config.port, () => {
  process.stdout.write(`LeetRepo API listening on port ${config.port}.\n`);
});

async function shutdown() {
  clearInterval(cleanupTimer);
  server.close();
  await store.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
