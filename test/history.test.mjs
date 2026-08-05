import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  listHistory,
  mergeDailyDigest,
  migrateLegacyHistory,
  readHistory,
  saveDailyDigest
} from "../src/lib/history.mjs";

function item(overrides = {}) {
  return {
    id: "article-1",
    source: "测试来源",
    region: "domestic",
    title: "测试文章",
    url: "https://example.com/article",
    publishedAt: "2026-08-03T08:00:00.000Z",
    category: "科技",
    score: 80,
    importance: "值得读",
    summary: "首次摘要",
    whyItMatters: "首次价值",
    impactForPeople: "首次普通人影响",
    impactAnalysis: {
      impactLevel: "间接",
      direction: "当前不变",
      changeStatement: "测试人群当前支出不变；规则生效后办理时间下降。",
      affectedGroups: ["测试人群"],
      impactPath: "首次影响路径",
      shortTerm: "首次短期影响",
      mediumLongTerm: "首次长期影响",
      actions: ["首次行动"],
      uncertainties: "首次不确定性"
    },
    confidence: "高",
    topics: ["测试"],
    ...overrides
  };
}

function digest(items, overrides = {}) {
  return {
    version: 1,
    generatedAt: "2026-08-03T10:00:00.000Z",
    date: "2026-08-03",
    brief: "本次概览",
    stats: { sources: 3, candidates: 10, selected: items.length, failedSources: 0 },
    sourceErrors: [],
    discardedReasons: [],
    items,
    ...overrides
  };
}

function run(id, completedAt = "2026-08-03T10:00:00.000Z") {
  return {
    id,
    date: "2026-08-03",
    startedAt: completedAt,
    completedAt,
    sources: 3,
    candidates: 10,
    selected: 1,
    failedSources: 0
  };
}

test("同日累计采用最新分析并保留首次发现时间", () => {
  const first = mergeDailyDigest(null, digest([item()]), run("run-1"));
  const second = mergeDailyDigest(first, digest([item({
    id: "changed-id",
    title: "测试文章（更新）",
    score: 92,
    summary: "最新摘要",
    impactForPeople: "最新普通人影响",
    impactAnalysis: {
      ...item().impactAnalysis,
      impactPath: "最新影响路径"
    }
  })]), run("run-2", "2026-08-03T11:00:00.000Z"));

  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].id, "article-1");
  assert.equal(second.items[0].summary, "最新摘要");
  assert.equal(second.items[0].score, 92);
  assert.equal(second.items[0].impactForPeople, "最新普通人影响");
  assert.equal(second.items[0].impactAnalysis.impactPath, "最新影响路径");
  assert.equal(second.items[0].firstSeenAt, "2026-08-03T10:00:00.000Z");
  assert.equal(second.items[0].lastSeenAt, "2026-08-03T11:00:00.000Z");
  assert.equal(second.items[0].seenCount, 2);
  assert.equal(second.stats.refreshCount, 2);
});

test("重复运行 ID 的合并是幂等的", () => {
  const first = mergeDailyDigest(null, digest([item()]), run("same-run"));
  const second = mergeDailyDigest(first, digest([item({ summary: "不应重复写入" })]), run("same-run"));
  assert.equal(second, first);
  assert.equal(second.items[0].seenCount, 1);
});

test("按日期写入、列出和读取本地历史", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-history-"));
  await mkdir(path.join(root, "public/data"), { recursive: true });
  await saveDailyDigest(root, digest([item()]), run("run-1"));

  const listing = await listHistory(root);
  assert.deepEqual(listing.errors, []);
  assert.equal(listing.dates[0].date, "2026-08-03");
  assert.equal(listing.dates[0].totalItems, 1);
  assert.equal((await readHistory(root, "2026-08-03")).version, 2);
  await assert.rejects(() => readHistory(root, "../secret"), { code: "INVALID_DATE" });
});

test("旧版 latest 迁移后重复执行不会重复累计", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-radar-migrate-"));
  await mkdir(path.join(root, "public/data/archive"), { recursive: true });
  await writeFile(path.join(root, "public/data/latest.json"), JSON.stringify(digest([item()])), "utf8");

  await migrateLegacyHistory(root);
  await migrateLegacyHistory(root);

  const migrated = JSON.parse(await readFile(path.join(root, "data/history/2026-08-03.json"), "utf8"));
  const latest = JSON.parse(await readFile(path.join(root, "public/data/latest.json"), "utf8"));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.items[0].seenCount, 1);
  assert.equal(migrated.runs.length, 1);
  assert.equal(latest.version, 2);
});
