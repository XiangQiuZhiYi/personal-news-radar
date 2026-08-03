import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson } from "../src/lib/history.mjs";
import { createNewsServer, getLanUrls } from "../src/serve.mjs";

async function listen(app) {
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("启动地址只包含可用的局域网 IPv4", () => {
  assert.deepEqual(getLanUrls(4173, {
    loopback: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    wifi: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
    duplicate: [{ family: 4, address: "192.168.1.20", internal: false }],
    linkLocal: [{ family: "IPv4", address: "169.254.2.3", internal: false }]
  }), ["http://192.168.1.20:4173"]);
});

test("刷新 API 异步运行、阻止并发并执行持久冷却", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-api-"));
  await mkdir(path.join(root, "public/data"), { recursive: true });
  let finish;
  const waiting = new Promise((resolve) => { finish = resolve; });
  let clock = new Date("2026-08-03T10:00:00.000Z");
  const app = createNewsServer({
    root,
    cooldownMs: 30 * 60 * 1000,
    now: () => new Date(clock),
    generate: async ({ onProgress }) => {
      onProgress("analyzing");
      await waiting;
      onProgress("saving");
    }
  });
  await app.initialize();
  const base = await listen(app);

  try {
    const forbidden = await fetch(`${base}/api/refresh`, {
      method: "POST",
      headers: { origin: "http://untrusted.example" }
    });
    assert.equal(forbidden.status, 403);

    const accepted = await fetch(`${base}/api/refresh`, { method: "POST" });
    assert.equal(accepted.status, 202);
    const acceptedStatus = await accepted.json();
    assert.equal(acceptedStatus.status, "running");
    assert.equal(acceptedStatus.cooldownUntil, null);

    const conflict = await fetch(`${base}/api/refresh`, { method: "POST" });
    assert.equal(conflict.status, 409);
    clock = new Date("2026-08-03T10:05:00.000Z");
    finish();

    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = await (await fetch(`${base}/api/refresh/status`)).json();
    assert.equal(status.status, "success");
    assert.equal(status.canRefresh, false);
    assert.equal(status.cooldownUntil, "2026-08-03T10:35:00.000Z");

    const cooled = await fetch(`${base}/api/refresh`, { method: "POST" });
    assert.equal(cooled.status, 429);
    assert.ok(Number(cooled.headers.get("retry-after")) > 0);

    clock = new Date("2026-08-03T10:35:00.000Z");
    const afterCooldown = await (await fetch(`${base}/api/refresh/status`)).json();
    assert.equal(afterCooldown.canRefresh, true);
  } finally {
    await close(app.server);
  }
});

test("刷新失败不触发冷却并可立即重试", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-api-failure-"));
  await mkdir(path.join(root, "public/data"), { recursive: true });
  let attempts = 0;
  const app = createNewsServer({
    root,
    cooldownMs: 30 * 60 * 1000,
    generate: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("模拟整理失败");
    }
  });
  await app.initialize();
  const base = await listen(app);

  try {
    assert.equal((await fetch(`${base}/api/refresh`, { method: "POST" })).status, 202);
    let failed;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      failed = await (await fetch(`${base}/api/refresh/status`)).json();
      if (failed.status === "error") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(failed.status, "error");
    assert.equal(failed.cooldownUntil, null);
    assert.equal(failed.cooldownRemainingMs, 0);
    assert.equal(failed.canRefresh, true);

    assert.equal((await fetch(`${base}/api/refresh`, { method: "POST" })).status, 202);
    let succeeded;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      succeeded = await (await fetch(`${base}/api/refresh/status`)).json();
      if (succeeded.status === "success") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(succeeded.status, "success");
    assert.equal(attempts, 2);
  } finally {
    await close(app.server);
  }
});

test("启动时清除旧版本遗留的失败冷却", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-old-failure-"));
  await mkdir(path.join(root, "public/data"), { recursive: true });
  await atomicWriteJson(path.join(root, "data/runtime/refresh-state.json"), {
    status: "error",
    cooldownUntil: "2099-01-01T00:00:00.000Z",
    error: "旧失败"
  });
  const app = createNewsServer({ root, generate: async () => {} });
  await app.initialize();
  const base = await listen(app);

  try {
    const status = await (await fetch(`${base}/api/refresh/status`)).json();
    assert.equal(status.cooldownUntil, null);
    assert.equal(status.cooldownRemainingMs, 0);
    assert.equal(status.canRefresh, true);
  } finally {
    await close(app.server);
  }
});

test("历史 API 返回列表、详情和安全错误", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-history-api-"));
  await mkdir(path.join(root, "public/data"), { recursive: true });
  const daily = {
    version: 2,
    date: "2026-08-03",
    updatedAt: "2026-08-03T10:00:00.000Z",
    brief: "历史概览",
    stats: { refreshCount: 1, totalItems: 0 },
    runs: [],
    sourceErrors: [],
    discardedReasons: [],
    items: []
  };
  await atomicWriteJson(path.join(root, "data/history/2026-08-03.json"), daily);
  const app = createNewsServer({ root, generate: async () => {} });
  await app.initialize();
  const base = await listen(app);

  try {
    const listing = await (await fetch(`${base}/api/history`)).json();
    assert.equal(listing.dates[0].date, "2026-08-03");
    const detail = await (await fetch(`${base}/api/history/2026-08-03`)).json();
    assert.equal(detail.brief, "历史概览");
    assert.equal((await fetch(`${base}/api/history/not-a-date`)).status, 400);
    assert.equal((await fetch(`${base}/api/history/2026-08-02`)).status, 404);
  } finally {
    await close(app.server);
  }
});
