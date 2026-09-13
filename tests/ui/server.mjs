import { createReadStream, lstatSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const uiRoot = resolve(repositoryRoot, "ui");
const canonicalRepositoryRoot = realpathSync(repositoryRoot);
const canonicalUiRoot = realpathSync(uiRoot);
const allowedRootFiles = new Set([
  "browse-state.js", "file-types.js", "media-metadata.js", "queue-state.js",
]);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
]);

function send(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(body);
}

const server = createServer((request, response) => {
  if (request.url === "/__health") {
    send(response, 200, "ok");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  } catch (_error) {
    send(response, 400, "Bad request");
    return;
  }
  const relativePath = pathname === "/" ? "ui/index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(repositoryRoot, relativePath);
  const isUiAsset = filePath.startsWith(`${uiRoot}${sep}`);
  const isSharedBrowserModule = allowedRootFiles.has(relativePath);
  if (relativePath.split("/").some((segment) => segment.startsWith(".")) || (!isUiAsset && !isSharedBrowserModule)) {
    send(response, 403, "Forbidden");
    return;
  }

  let linkStats;
  let stats;
  let canonicalPath;
  try {
    linkStats = lstatSync(filePath);
    stats = statSync(filePath);
    canonicalPath = realpathSync(filePath);
  } catch (_error) {
    send(response, 404, "Not found");
    return;
  }
  const canonicalAllowed = canonicalPath.startsWith(`${canonicalUiRoot}${sep}`) || (
    allowedRootFiles.has(relativePath)
    && canonicalPath.startsWith(`${canonicalRepositoryRoot}${sep}`)
  );
  if (linkStats.isSymbolicLink() || !stats.isFile() || !canonicalAllowed) {
    send(response, 404, "Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
});

server.listen(4173, "127.0.0.1");

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
