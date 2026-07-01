import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.env.PLAYWRIGHT_STATIC_ROOT ?? path.join(process.cwd(), "frontend/dist/aipportal-web"));
const host = argValue("--host") ?? process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const port = Number(argValue("--port") ?? process.env.PLAYWRIGHT_PORT ?? 4173);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[extension] ?? "application/octet-stream";
}

function safePath(pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(root, relativePath);
  return filePath.startsWith(root + path.sep) || filePath === root ? filePath : null;
}

async function existingFile(filePath) {
  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      return existingFile(path.join(filePath, "index.html"));
    }

    return stats.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname.includes("\0")) {
    response.writeHead(400).end("Bad request");
    return;
  }

  const requestedPath = safePath(pathname);
  if (!requestedPath) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let filePath = await existingFile(requestedPath);
  if (!filePath) {
    if (pathname.startsWith("/api/")) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Endpoint not found." }));
      return;
    }

    filePath = await existingFile(path.join(root, "index.html"));
    if (!filePath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Angular build output was not found. Run npm run build in frontend/ before Playwright.");
      return;
    }
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": contentType(filePath)
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
