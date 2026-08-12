import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { createApi } from "./api.js";
import { createPool, DataStore } from "./database.js";

const config = loadConfig();
const pool = createPool(config);
const store = new DataStore(pool);
const api = createApi({ config, store });
pool.on("error", () => {
  process.stderr.write(`${JSON.stringify({ level: "error", event: "database_pool_error" })}\n`);
});
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
  const requestId = randomUUID();
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
    const headers = Object.fromEntries(response.headers);
    headers["X-Request-Id"] = requestId;
    headers["Referrer-Policy"] = "no-referrer";
    headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
    if (config.nodeEnv === "production") headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    outgoing.writeHead(response.status, headers);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    status = error.message === "REQUEST_TOO_LARGE" ? 413 : 500;
    outgoing.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
      "Referrer-Policy": "no-referrer"
    });
    outgoing.end(JSON.stringify({ error: { code: status === 413 ? "REQUEST_TOO_LARGE" : "INTERNAL_ERROR", message: status === 413 ? "Request body is too large." : "The service could not complete this request." } }));
  } finally {
    const pathname = new URL(incoming.url || "/", config.publicBaseUrl).pathname;
    process.stdout.write(`${JSON.stringify({
      level: "info",
      requestId,
      method: incoming.method || "GET",
      path: pathname,
      status,
      durationMs: Date.now() - startedAt
    })}\n`);
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.listen(config.port, () => {
  process.stdout.write(`LeetRepo API listening on port ${config.port}.\n`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`${JSON.stringify({ level: "info", event: "shutdown", signal })}\n`);
  clearInterval(cleanupTimer);
  const forceClose = setTimeout(() => server.closeAllConnections(), 25_000);
  forceClose.unref();
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(forceClose);
  await store.close();
}

process.on("SIGINT", () => shutdown("SIGINT").catch(() => { process.exitCode = 1; }));
process.on("SIGTERM", () => shutdown("SIGTERM").catch(() => { process.exitCode = 1; }));
