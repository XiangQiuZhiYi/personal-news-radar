import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { atomicWriteJson } from "../src/lib/history.mjs";
import {
  buildStaticDigest,
  pushStaticDigest,
  scheduledRunDue
} from "../src/lib/static-publish.mjs";

const execFile = promisify(execFileCallback);

function result(overrides = {}) {
  return {
    digest: {
      version: 1,
      date: "2026-08-20",
      generatedAt: "2026-08-20T09:00:00.000Z",
      brief: "今日晚报",
      stats: { selected: 1 },
      items: [{ id: "news-1", title: "测试新闻", url: "https://example.com/1" }]
    },
    collected: {
      sourceCount: 2,
      items: [{ id: "candidate-1" }],
      errors: []
    },
    ...overrides
  };
}

test("完整分析成功后才原子更新静态晚报", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-static-build-"));
  const built = await buildStaticDigest({ root, generate: async () => result() });
  const saved = JSON.parse(await readFile(path.join(root, "public/data/latest.json"), "utf8"));
  assert.equal(saved.date, "2026-08-20");
  assert.equal(saved.items[0].id, "news-1");
  assert.equal(built.outputPath, path.join(root, "public/data/latest.json"));
});

test("分析失败或全部信息源失败时保留上一版晚报", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-static-failure-"));
  const latest = path.join(root, "public/data/latest.json");
  await atomicWriteJson(latest, { date: "2026-08-19", items: [{ id: "old" }] });

  await assert.rejects(() => buildStaticDigest({
    root,
    generate: async () => { throw new Error("Codex 失败"); }
  }), /Codex 失败/);
  assert.equal(JSON.parse(await readFile(latest, "utf8")).items[0].id, "old");

  await assert.rejects(() => buildStaticDigest({
    root,
    generate: async () => result({
      digest: { version: 1, date: "2026-08-20", generatedAt: "2026-08-20T09:00:00.000Z", items: [] },
      collected: { sourceCount: 2, items: [], errors: [{}, {}] }
    })
  }), /所有信息源均采集失败/);
  assert.equal(JSON.parse(await readFile(latest, "utf8")).items[0].id, "old");
});

test("计划任务在 17 点后补跑且一天只成功发布一次", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-static-schedule-"));
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(path.join(root, "config/sources.json"), JSON.stringify({ timezone: "Asia/Shanghai" }));

  const before = await scheduledRunDue({ root, now: new Date("2026-08-20T08:59:00.000Z") });
  assert.equal(before.due, false);
  assert.match(before.reason, /尚未到/);
  const after = await scheduledRunDue({ root, now: new Date("2026-08-20T09:01:00.000Z") });
  assert.equal(after.due, true);

  await atomicWriteJson(path.join(root, "data/runtime/last-publish.json"), { date: "2026-08-20" });
  const repeated = await scheduledRunDue({ root, now: new Date("2026-08-20T10:00:00.000Z") });
  assert.equal(repeated.due, false);
  assert.match(repeated.reason, /已经成功发布/);
});

async function git(root, args) {
  return execFile("/usr/bin/git", args, { cwd: root, encoding: "utf8" });
}

test("发布只提交静态数据文件并推送 main", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-static-git-"));
  const remote = await mkdtemp(path.join(os.tmpdir(), "news-static-remote-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "News Test"]);
  await git(root, ["config", "user.email", "news-test@example.com"]);
  await mkdir(path.join(root, "public/data"), { recursive: true });
  await writeFile(path.join(root, "public/data/latest.json"), "{\"date\":\"2026-08-19\"}\n");
  await writeFile(path.join(root, "notes.txt"), "initial\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "initial"]);
  await execFile("/usr/bin/git", ["init", "--bare", remote]);
  await git(root, ["remote", "add", "origin", remote]);
  await git(root, ["push", "-u", "origin", "main"]);

  await writeFile(path.join(root, "public/data/latest.json"), "{\"date\":\"2026-08-20\"}\n");
  await writeFile(path.join(root, "notes.txt"), "user change\n");
  await git(root, ["add", "notes.txt"]);
  await pushStaticDigest({ root, digest: { date: "2026-08-20" } });

  const shown = await git(root, ["show", "--pretty=format:", "--name-only", "HEAD"]);
  assert.equal(shown.stdout.trim(), "public/data/latest.json");
  const staged = await git(root, ["diff", "--cached", "--name-only"]);
  assert.equal(staged.stdout.trim(), "notes.txt");
  const remoteHead = await execFile("/usr/bin/git", ["--git-dir", remote, "show", "main:public/data/latest.json"], { encoding: "utf8" });
  assert.match(remoteHead.stdout, /2026-08-20/);
});
