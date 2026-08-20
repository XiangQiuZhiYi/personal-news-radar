import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateDigest } from "./generate.mjs";
import { atomicWriteJson, readJsonIfExists } from "./history.mjs";
import { acquireRefreshLock } from "./runtime.mjs";

const execFile = promisify(execFileCallback);
const LAST_PUBLISH_PATH = "data/runtime/last-publish.json";

function assertDigest(result) {
  const digest = result?.digest;
  if (!digest || !/^\d{4}-\d{2}-\d{2}$/.test(digest.date ?? "")) {
    throw new Error("Codex 没有生成有效日期的静态晚报");
  }
  if (!Array.isArray(digest.items)) throw new Error("Codex 返回的静态晚报缺少 items 数组");
  const sourceCount = Number(result?.collected?.sourceCount) || 0;
  const errors = result?.collected?.errors ?? [];
  if (sourceCount === 0) throw new Error("没有启用的信息源，保留上一版晚报");
  if ((result?.collected?.items?.length ?? 0) === 0 && errors.length >= sourceCount) {
    throw new Error("所有信息源均采集失败，保留上一版晚报");
  }
  return digest;
}

export async function buildStaticDigest({
  root,
  fixturePath = null,
  now = () => new Date(),
  generate = generateDigest,
  onProgress = () => {}
}) {
  const lock = await acquireRefreshLock(root, now());
  try {
    const result = await generate({ root, fixturePath, now, onProgress });
    const digest = assertDigest(result);
    const outputPath = path.join(root, "public/data/latest.json");
    await atomicWriteJson(outputPath, digest);
    return { ...result, outputPath };
  } finally {
    await lock.release();
  }
}

async function git(root, args) {
  const result = await execFile("/usr/bin/git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  return String(result.stdout ?? "").trim();
}

export async function assertPublishBranch(root, expectedBranch = "main") {
  const branch = await git(root, ["branch", "--show-current"]);
  if (branch !== expectedBranch) {
    throw new Error(`自动发布要求当前分支为 ${expectedBranch}，现在是 ${branch || "游离 HEAD"}`);
  }
  return branch;
}

export async function pushStaticDigest({ root, digest, remote = "origin", branch = "main" }) {
  await assertPublishBranch(root, branch);
  const relativePath = "public/data/latest.json";
  const status = await git(root, ["status", "--porcelain", "--", relativePath]);
  let committed = false;
  if (status) {
    await git(root, ["add", "--", relativePath]);
    await git(root, [
      "commit",
      "--only",
      "-m",
      `chore: publish news digest ${digest.date}`,
      "--",
      relativePath
    ]);
    committed = true;
  }
  await git(root, ["push", remote, `${branch}:${branch}`]);
  await atomicWriteJson(path.join(root, LAST_PUBLISH_PATH), {
    date: digest.date,
    publishedAt: new Date().toISOString(),
    commitCreated: committed,
    remote,
    branch
  });
  return { committed };
}

function zonedParts(date, timezone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

export async function scheduledRunDue({ root, now = new Date(), hour = 17, minute = 0 }) {
  const sourceConfig = JSON.parse(await readFile(path.join(root, "config/sources.json"), "utf8"));
  const timezone = sourceConfig.timezone ?? "Asia/Shanghai";
  const current = zonedParts(now, timezone);
  if (current.minutes < hour * 60 + minute) {
    return { due: false, reason: `尚未到 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, date: current.date };
  }
  const previous = await readJsonIfExists(path.join(root, LAST_PUBLISH_PATH));
  if (previous?.date === current.date) {
    return { due: false, reason: "今天已经成功发布", date: current.date };
  }
  return { due: true, reason: "需要发布", date: current.date };
}
