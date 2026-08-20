import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDigest, projectRoot } from "./lib/generate.mjs";
import { listFavorites, listFavoriteIds, readFavorites, saveFavorite } from "./lib/favorites.mjs";
import { listHistory, readHistory, runIdFor } from "./lib/history.mjs";
import { acquireRefreshLock } from "./lib/runtime.mjs";

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

export function getLanUrls(port, interfaces = networkInterfaces()) {
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => (entry.family === "IPv4" || entry.family === 4) && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => address && !address.startsWith("169.254."));
  return [...new Set(addresses)].map((address) => `http://${address}:${port}`);
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function compactError(error) {
  return String(error?.message ?? error ?? "未知错误").split("\n")[0].slice(0, 300);
}

function originIsAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const expected = new URL(request.url, `http://${request.headers.host ?? "localhost"}`).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

async function readJsonBody(request, maxBytes = 16 * 1024) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error("请求内容过大");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const error = new Error("请求内容不是有效 JSON");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function publicStatus(state, now) {
  const cooldownUntil = state.cooldownUntil ?? null;
  const remaining = Math.max(0, Date.parse(cooldownUntil ?? "") - now.getTime()) || 0;
  return {
    status: state.status ?? "idle",
    jobId: state.jobId ?? null,
    phase: state.phase ?? null,
    startedAt: state.startedAt ?? null,
    finishedAt: state.finishedAt ?? null,
    cooldownUntil,
    cooldownRemainingMs: remaining,
    canRefresh: state.status !== "running" && remaining === 0,
    error: state.error ?? null
  };
}

export function createNewsServer({
  root = projectRoot,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  now = () => new Date(),
  generate = generateDigest
} = {}) {
  const publicRoot = path.join(root, "public");
  let currentJob = null;
  let currentDigest = null;

  async function initialize() {
    let lock;
    try {
      lock = await acquireRefreshLock(root, now());
    } catch (error) {
      if (error.code !== "REFRESH_LOCKED") throw error;
    } finally {
      await lock?.release();
    }
  }

  async function startRefresh(request, response) {
    if (!originIsAllowed(request)) {
      sendJson(response, 403, { error: "请求来源不允许" });
      return;
    }
    if (currentJob?.status === "running") {
      sendJson(response, 409, publicStatus(currentJob, now()));
      return;
    }

    const acceptedAt = now();
    const remainingMs = Date.parse(currentJob?.cooldownUntil ?? "") - acceptedAt.getTime();
    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      sendJson(response, 429, publicStatus(currentJob, acceptedAt), {
        "retry-after": String(Math.ceil(remainingMs / 1000))
      });
      return;
    }

    let lock;
    try {
      lock = await acquireRefreshLock(root, acceptedAt);
    } catch (error) {
      if (error.code === "REFRESH_LOCKED") {
        sendJson(response, 409, { error: error.message, status: "running" });
        return;
      }
      throw error;
    }

    const jobId = runIdFor(acceptedAt);
    currentJob = {
      status: "running",
      jobId,
      phase: "collecting",
      startedAt: acceptedAt.toISOString(),
      finishedAt: null,
      cooldownUntil: null,
      error: null
    };
    sendJson(response, 202, publicStatus(currentJob, acceptedAt));

    Promise.resolve().then(async () => {
      let finalState;
      try {
        const result = await generate({
          root,
          now,
          startedAt: acceptedAt,
          runId: jobId,
          onProgress(phase) {
            currentJob = { ...currentJob, phase };
          }
        });
        currentDigest = result?.digest ?? null;
        const finishedAt = now();
        finalState = {
          ...currentJob,
          status: "success",
          phase: null,
          finishedAt: finishedAt.toISOString(),
          cooldownUntil: new Date(finishedAt.getTime() + cooldownMs).toISOString()
        };
      } catch (error) {
        console.error(error.stack || error.message);
        finalState = {
          ...currentJob,
          status: "error",
          phase: null,
          finishedAt: now().toISOString(),
          cooldownUntil: null,
          error: compactError(error)
        };
      } finally {
        await lock.release().catch((error) => console.error(error.stack || error.message));
        currentJob = finalState;
      }
    });
  }

  async function handler(request, response) {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const requestPath = decodeURIComponent(requestUrl.pathname);

      if (requestPath === "/api/refresh") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" }, { allow: "POST" });
          return;
        }
        await startRefresh(request, response);
        return;
      }

      if (requestPath === "/api/refresh/status") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET" });
          return;
        }
        const state = currentJob ?? { status: "idle", cooldownUntil: null };
        sendJson(response, 200, publicStatus(state, now()));
        return;
      }

      if (requestPath === "/api/current") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET" });
          return;
        }
        sendJson(response, 200, currentDigest ?? {
          version: 1,
          date: null,
          generatedAt: null,
          brief: "当前没有临时整理结果，请点击“获取最新消息”。",
          stats: { sources: 0, candidates: 0, selected: 0, domesticSelected: 0, internationalSelected: 0 },
          sourceErrors: [],
          discardedReasons: [],
          items: []
        });
        return;
      }

      if (requestPath === "/api/favorites/ids") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET" });
          return;
        }
        sendJson(response, 200, { ids: await listFavoriteIds(root) });
        return;
      }

      if (requestPath === "/api/favorites") {
        if (request.method === "GET") {
          sendJson(response, 200, await listFavorites(root));
          return;
        }
        if (request.method === "POST") {
          if (!originIsAllowed(request)) {
            sendJson(response, 403, { error: "请求来源不允许" });
            return;
          }
          if (!currentDigest) {
            sendJson(response, 409, { error: "当前没有可收藏的临时整理结果" });
            return;
          }
          let body;
          try {
            body = await readJsonBody(request);
          } catch (error) {
            sendJson(response, error.code === "BODY_TOO_LARGE" ? 413 : 400, { error: error.message });
            return;
          }
          try {
            const saved = await saveFavorite(root, currentDigest, body.itemId, now());
            sendJson(response, saved.alreadySaved ? 200 : 201, {
              saved: true,
              alreadySaved: saved.alreadySaved,
              itemId: String(saved.item.id ?? saved.item.url),
              date: saved.collection.date
            });
          } catch (error) {
            if (error.code === "FAVORITE_NOT_FOUND") {
              sendJson(response, 404, { error: error.message });
              return;
            }
            throw error;
          }
          return;
        }
        sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET, POST" });
        return;
      }

      if (requestPath.startsWith("/api/favorites/")) {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET" });
          return;
        }
        const date = requestPath.slice("/api/favorites/".length);
        let collection;
        try {
          collection = await readFavorites(root, date);
        } catch (error) {
          if (error.code === "INVALID_DATE") {
            sendJson(response, 400, { error: error.message });
            return;
          }
          throw error;
        }
        if (!collection) {
          sendJson(response, 404, { error: "没有找到该日期的收藏记录" });
          return;
        }
        sendJson(response, 200, collection);
        return;
      }

      if (requestPath === "/api/history") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET" });
          return;
        }
        sendJson(response, 200, await listHistory(root));
        return;
      }

      if (requestPath.startsWith("/api/history/")) {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "Method not allowed" }, { allow: "GET" });
          return;
        }
        const date = requestPath.slice("/api/history/".length);
        let digest;
        try {
          digest = await readHistory(root, date);
        } catch (error) {
          if (error.code === "INVALID_DATE") {
            sendJson(response, 400, { error: error.message });
            return;
          }
          throw error;
        }
        if (!digest) {
          sendJson(response, 404, { error: "没有找到该日期的历史记录" });
          return;
        }
        sendJson(response, 200, digest);
        return;
      }

      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
        response.end("Method not allowed");
        return;
      }
      const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      const filePath = path.resolve(publicRoot, relative);
      if (!filePath.startsWith(`${publicRoot}${path.sep}`) && filePath !== path.join(publicRoot, "index.html")) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "content-type": types[path.extname(filePath)] ?? "application/octet-stream",
        "cache-control": filePath.endsWith("latest.json") ? "no-store" : "public, max-age=300"
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(filePath).pipe(response);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (request.url?.startsWith("/api/")) {
        console.error(error.stack || error.message);
        sendJson(response, 500, { error: "服务器处理请求失败" });
      } else {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
      }
    }
  }

  return { server: createServer(handler), initialize };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4173);
  const app = createNewsServer();
  await app.initialize();
  app.server.listen(port, "0.0.0.0", () => {
    const urls = getLanUrls(port);
    if (urls.length === 0) {
      console.log(`信息晚报已启动，端口 ${port}；未找到可显示的局域网 IPv4 地址。`);
      return;
    }
    console.log("信息晚报已启动，局域网地址：");
    urls.forEach((url) => console.log(`  ${url}`));
  });
}
