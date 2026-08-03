import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireRefreshLock, readRefreshState, writeRefreshState } from "../src/lib/runtime.mjs";

test("跨进程锁阻止并发并可在释放后重新获取", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-lock-"));
  const first = await acquireRefreshLock(root);
  await assert.rejects(() => acquireRefreshLock(root), { code: "REFRESH_LOCKED" });
  await first.release();
  const second = await acquireRefreshLock(root);
  await second.release();
});

test("陈旧锁可被清理", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-stale-lock-"));
  const runtime = path.join(root, "data/runtime");
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, "refresh.lock"), JSON.stringify({
    pid: 2147483647,
    startedAt: "2020-01-01T00:00:00.000Z",
    token: "old"
  }), "utf8");
  const lock = await acquireRefreshLock(root, new Date("2026-08-03T00:00:00.000Z"));
  await lock.release();
});

test("刚创建但尚未写完的锁不会被误删", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-new-lock-"));
  const runtime = path.join(root, "data/runtime");
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, "refresh.lock"), "", "utf8");
  await assert.rejects(() => acquireRefreshLock(root), { code: "REFRESH_LOCKED" });
});

test("刷新冷却状态写入真实文件并可恢复", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-state-"));
  const expected = {
    status: "success",
    cooldownUntil: "2026-08-03T10:30:00.000Z"
  };
  await writeRefreshState(root, expected);
  assert.deepEqual(await readRefreshState(root), expected);
});
