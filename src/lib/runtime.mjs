import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, readJsonIfExists } from "./history.mjs";

const STALE_LOCK_MS = 15 * 60 * 1000;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function removeStaleLock(lockPath, now) {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8"));
    const age = now.getTime() - Date.parse(value.startedAt ?? "");
    if (processIsAlive(value.pid) || (Number.isFinite(age) && age < STALE_LOCK_MS)) return false;
    await rm(lockPath, { force: true });
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    try {
      const info = await stat(lockPath);
      if (now.getTime() - info.mtimeMs < STALE_LOCK_MS) return false;
    } catch (statError) {
      if (statError.code === "ENOENT") return true;
      throw statError;
    }
    await rm(lockPath, { force: true });
    return true;
  }
}

export async function acquireRefreshLock(root, now = new Date()) {
  const runtimeDirectory = path.join(root, "data/runtime");
  const lockPath = path.join(runtimeDirectory, "refresh.lock");
  await mkdir(runtimeDirectory, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, startedAt: now.toISOString() }));
      } catch (error) {
        await rm(lockPath, { force: true }).catch(() => {});
        throw error;
      } finally {
        await handle.close();
      }
      return {
        async release() {
          try {
            const current = JSON.parse(await readFile(lockPath, "utf8"));
            if (current.token === token) await rm(lockPath, { force: true });
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (attempt === 0 && await removeStaleLock(lockPath, now)) continue;
      const locked = new Error("已有信息整理任务正在运行");
      locked.code = "REFRESH_LOCKED";
      throw locked;
    }
  }
  throw new Error("无法获取信息整理任务锁");
}

export async function readRefreshState(root) {
  return await readJsonIfExists(path.join(root, "data/runtime/refresh-state.json")) ?? {
    status: "idle",
    cooldownUntil: null
  };
}

export async function writeRefreshState(root, state) {
  await atomicWriteJson(path.join(root, "data/runtime/refresh-state.json"), state);
}
